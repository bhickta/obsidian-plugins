import { App, Notice, TFile } from "obsidian";
import { ArchiveStore } from "./archive";
import { EmbeddingIndex } from "./embeddings";
import { OpenAICompatibleClient } from "./openai-client";
import {
  CoverageReport,
  JudgeResult,
  MergeDecision,
  MergeSuggestion,
  SimilarCandidate,
  ZettelMergeSettings,
} from "./types";
import {
  buildCoverageReport,
  compactNote,
  formatMissingForRetry,
  isVisibleMarkdownInScope,
  stripMarkdownFence,
} from "./utils";

interface DecisionsResponse {
  decisions: Array<Partial<MergeDecision>>;
}

export class MergeEngine {
  private client: OpenAICompatibleClient;
  private archive: ArchiveStore;

  constructor(
    private app: App,
    private settings: ZettelMergeSettings,
    private setStatus: (text: string) => void,
  ) {
    this.client = new OpenAICompatibleClient(settings);
    this.archive = new ArchiveStore(app, settings);
  }

  async suggestForActive(silent = false): Promise<MergeSuggestion[]> {
    const active = this.requireActiveNote();
    if (!this.isInMergeScope(active)) {
      if (!silent) new Notice(`Active note is outside ${this.settings.rootFolder}`);
      return [];
    }

    this.setStatus("Finding merge candidates...");
    const index = new EmbeddingIndex(this.app, this.settings, this.client);
    const similar = await index.findSimilar(active, text => this.setStatus(text));
    if (!similar.length) {
      if (!silent) new Notice("No candidate notes found.");
      return [];
    }

    this.setStatus("Judging mergeability...");
    const activeContent = await this.app.vault.read(active);
    const suggestions = await this.judgeCandidates(active, activeContent, similar);
    this.setStatus("");

    if (!suggestions.length && !silent) new Notice("No mergeable candidates found.");
    return suggestions;
  }

  async mergeIntoActive(active: TFile, suggestions: MergeSuggestion[]): Promise<void> {
    if (!suggestions.length) {
      new Notice("No merge candidates selected.");
      return;
    }
    if (!this.isInMergeScope(active)) throw new Error(`Active note is outside ${this.settings.rootFolder}.`);

    const sourceFiles = suggestions.map(suggestion => suggestion.file);
    const targetContent = await this.app.vault.read(active);
    const sourceContents = await Promise.all(sourceFiles.map(file => this.app.vault.read(file)));
    const decisions = suggestions.map(suggestion => suggestion.decision);

    this.setStatus("Archiving originals...");
    const job = await this.archive.createJob(active, sourceFiles, targetContent, sourceContents, decisions);

    const basePrompt = this.buildMergeUserPrompt(active, targetContent, sourceFiles, sourceContents);
    const proposedAttempts: string[] = [];
    let finalContent = "";
    let finalCoverage: CoverageReport | null = null;
    let finalJudge: JudgeResult | null = null;
    let hint = "";

    for (let attempt = 1; attempt <= this.settings.maxMergeRetries; attempt++) {
      this.setStatus(`Merging attempt ${attempt}/${this.settings.maxMergeRetries}...`);
      const prompt = hint ? `${basePrompt}\n\nRETRY REQUIREMENTS:\n${hint}` : basePrompt;
      const proposed = stripMarkdownFence(await this.client.chat([
        { role: "system", content: this.settings.mergeSystemPrompt },
        { role: "user", content: prompt },
      ], { temperature: 0 }));
      proposedAttempts.push(proposed);
      await this.archive.writeProposed(job, attempt, proposed);

      this.setStatus(`Validating attempt ${attempt}/${this.settings.maxMergeRetries}...`);
      const sourceMaterial = [targetContent, ...sourceContents].join("\n\n--- SOURCE BREAK ---\n\n");
      const coverage = buildCoverageReport(sourceMaterial, proposed);
      const judge = await this.judgeMergedOutput(sourceMaterial, proposed);

      finalContent = proposed;
      finalCoverage = coverage;
      finalJudge = judge;

      if (this.isValidated(coverage, judge)) break;

      hint = formatMissingForRetry(coverage, judge.missing_facts);
      if (!hint) hint = "The validator failed. Re-check all source facts and preserve every missing or transformed detail.";
    }

    if (!finalCoverage || !finalJudge) throw new Error("Merge produced no validation result.");

    if (!this.isValidated(finalCoverage, finalJudge)) {
      await this.archive.markFailedValidation(job, proposedAttempts.length, finalCoverage, finalJudge);
      this.setStatus("");
      new Notice(`Merge blocked. Archive saved at ${job.basePath}; source files were not deleted.`, 10000);
      return;
    }

    this.setStatus("Writing archive and training data...");
    await this.archive.finalizeBeforeApply(
      job,
      finalContent,
      proposedAttempts.length,
      finalCoverage,
      finalJudge,
      basePrompt,
      proposedAttempts,
    );

    this.setStatus("Applying merge...");
    await this.app.vault.modify(active, finalContent.endsWith("\n") ? finalContent : finalContent + "\n");

    const deletedSources: string[] = [];
    if (this.settings.deleteSourcesAfterMerge) {
      for (const source of sourceFiles) {
        deletedSources.push(source.path);
        await this.app.vault.delete(source);
      }
    }

    await this.archive.markApplied(job, deletedSources);
    this.setStatus("");
    new Notice(`Merged ${sourceFiles.length} note(s). Archive: ${job.id}`, 10000);
  }

  async autoMergeActive(): Promise<void> {
    if (!this.settings.autoMergeEnabled) {
      new Notice("Enable auto-merge in Zettel Merge AI settings first.");
      return;
    }
    const active = this.requireActiveNote();
    const suggestions = await this.suggestForActive(false);
    const auto = suggestions.filter(suggestion => suggestion.decision.confidence >= this.settings.autoMergeThreshold);
    if (!auto.length) {
      new Notice("No candidates met the auto-merge threshold.");
      return;
    }
    await this.mergeIntoActive(active, auto);
  }

  async rebuildEmbeddingIndex(): Promise<void> {
    const index = new EmbeddingIndex(this.app, this.settings, this.client);
    await index.clear();
    new Notice("Zettel Merge AI embedding cache cleared. Run suggestions to rebuild it.");
  }

  async restoreLatestAppliedMerge(): Promise<void> {
    const jobId = await this.archive.restoreLatestApplied();
    new Notice(`Restored merge job ${jobId}.`, 10000);
  }

  private async judgeCandidates(active: TFile, activeContent: string, candidates: SimilarCandidate[]): Promise<MergeSuggestion[]> {
    const payload = candidates.map((candidate, index) => ({
      id: index + 1,
      path: candidate.file.path,
      similarity: Number(candidate.similarity.toFixed(4)),
      note: compactNote(candidate.file.path, candidate.content, this.settings.candidateJudgeChars),
    }));

    const response = await this.client.chatJson<DecisionsResponse>([
      {
        role: "system",
        content: [
          "You decide whether candidate Zettelkasten notes should be merged into the active note.",
          "Return JSON only.",
          "Use action=merge only for duplicates, fragmented versions of the same concept, or notes whose facts clearly belong inside the active note.",
          "Use action=skip for merely related notes, parent/child context, same broad subject, or separate concepts.",
          "Do not suggest links. This workflow only merges or skips.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          active_note: compactNote(active.path, activeContent, this.settings.candidateJudgeChars),
          candidates: payload,
          required_schema: {
            decisions: [{
              path: "candidate path",
              action: "merge or skip",
              confidence: "number 0..1",
              risk: "low, medium, or high",
              reason: "short reason",
            }],
          },
        }, null, 2),
      },
    ], { temperature: 0 });

    const byPath = new Map<string, Partial<MergeDecision>>();
    for (const decision of response.decisions || []) {
      if (typeof decision.path === "string") byPath.set(decision.path, decision);
    }

    return candidates
      .map(candidate => {
        const raw = byPath.get(candidate.file.path);
        if (!raw || raw.action !== "merge") return null;
        const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
        if (confidence < this.settings.reviewThreshold) return null;
        const decision: MergeDecision = {
          path: candidate.file.path,
          action: "merge",
          confidence,
          reason: raw.reason || "Model marked this candidate as mergeable.",
          risk: raw.risk === "medium" || raw.risk === "high" ? raw.risk : "low",
        };
        return { ...candidate, decision };
      })
      .filter((value): value is MergeSuggestion => value !== null)
      .sort((a, b) => b.decision.confidence - a.decision.confidence);
  }

  private async judgeMergedOutput(sourceMaterial: string, candidate: string): Promise<JudgeResult> {
    const response = await this.client.chatJson<Partial<JudgeResult>>([
      {
        role: "system",
        content: [
          "You are a strict no-loss merge verifier.",
          "Compare source notes against the candidate merged note.",
          "Fail if any source fact, date, number, name, qualifier, tag, wikilink, or meaningful detail is missing.",
          "Fail if the candidate adds unsupported external knowledge.",
          "Return JSON only.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          source_notes: sourceMaterial,
          candidate_merged_note: candidate,
          required_schema: {
            verdict: "pass or fail",
            score: "number 0..1",
            missing_facts: ["facts missing from candidate"],
            unsupported_additions: ["facts in candidate not supported by source"],
            notes: "short explanation",
          },
        }),
      },
    ], { temperature: 0 });

    return {
      verdict: response.verdict === "pass" ? "pass" : "fail",
      score: typeof response.score === "number" ? response.score : 0,
      missing_facts: Array.isArray(response.missing_facts) ? response.missing_facts.map(String) : [],
      unsupported_additions: Array.isArray(response.unsupported_additions) ? response.unsupported_additions.map(String) : [],
      notes: response.notes || "",
    };
  }

  private buildMergeUserPrompt(active: TFile, targetContent: string, sourceFiles: TFile[], sourceContents: string[]): string {
    const sections = [
      `ACTIVE NOTE PATH: ${active.path}`,
      "ACTIVE NOTE CONTENT:",
      targetContent,
      "",
      "SOURCE NOTES TO MERGE INTO ACTIVE NOTE:",
    ];
    for (let i = 0; i < sourceFiles.length; i++) {
      sections.push(`\n--- SOURCE ${i + 1}: ${sourceFiles[i].path} ---\n${sourceContents[i]}`);
    }
    const prompt = sections.join("\n");
    if (prompt.length > this.settings.maxMergeInputChars) {
      throw new Error(`Merge input is ${prompt.length} characters, above maxMergeInputChars=${this.settings.maxMergeInputChars}. Increase the setting or merge fewer notes.`);
    }
    return prompt;
  }

  private isValidated(coverage: CoverageReport, judge: JudgeResult): boolean {
    return coverage.requiredMissingCount === 0
      && coverage.score >= this.settings.validationThreshold
      && judge.verdict === "pass"
      && judge.score >= this.settings.validationThreshold
      && judge.unsupported_additions.length === 0;
  }

  private requireActiveNote(): TFile {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== "md") throw new Error("Open a markdown note first.");
    return active;
  }

  private isInMergeScope(file: TFile): boolean {
    return isVisibleMarkdownInScope(file, this.settings.rootFolder, this.settings.dataFolder);
  }
}
