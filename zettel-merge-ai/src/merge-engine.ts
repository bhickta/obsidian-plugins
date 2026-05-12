import { App, Notice, TFile } from "obsidian";
import { ArchiveStore } from "./archive";
import { EmbeddingIndex } from "./embeddings";
import { OpenAICompatibleClient } from "./openai-client";
import {
  CoverageReport,
  JudgeResult,
  MergeDecision,
  MergeJob,
  MergeSuggestion,
  SimilarCandidate,
  ZettelMergeSettings,
} from "./types";
import {
  buildCoverageReport,
  compactNote,
  formatMissingForRetry,
  hasMeaningfulMarkdown,
  isVisibleMarkdownInScope,
  requireActiveMarkdownFile,
  sha256,
} from "./utils";
import {
  applyScopedMergePlan,
  buildMergeUserPrompt,
  buildSourceExtraction,
  formatScopedMergeAttempt,
  normalizeScopedMergePlan,
  normalizeSourceLineRanges,
  numberedExcerpt,
  scopedMergeSystemPrompt,
  type SourceExtraction,
  type ScopedMergePlanResponse,
} from "./merge-plan";

interface RawMergeDecision extends Partial<MergeDecision> {
  source_line_ranges?: unknown;
  extract_ranges?: unknown;
}

interface DecisionsResponse {
  decisions: RawMergeDecision[];
}

interface MergeInputs {
  sourceFiles: TFile[];
  targetContent: string;
  sourceContents: string[];
  decisions: MergeDecision[];
  sourceExtractions: SourceExtraction[];
  sourceMaterial: string;
  mergeSystemPrompt: string;
  basePrompt: string;
}

interface MergeAttemptResult {
  finalContent: string;
  finalCoverage: CoverageReport;
  finalJudge: JudgeResult;
  proposedAttempts: string[];
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
    const active = requireActiveMarkdownFile(this.app);
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

    const inputs = await this.loadMergeInputs(active, suggestions);

    this.setStatus("Archiving originals...");
    const job = await this.archive.createJob(active, inputs.sourceFiles, inputs.targetContent, inputs.sourceContents, inputs.decisions);
    const attemptResult = await this.runScopedMergeAttempts(job, inputs);

    if (!this.isValidated(attemptResult.finalCoverage, attemptResult.finalJudge)) {
      await this.archive.markFailedValidation(job, attemptResult.proposedAttempts.length, attemptResult.finalCoverage, attemptResult.finalJudge);
      this.setStatus("");
      new Notice(`Merge blocked. Archive saved at ${job.basePath}; source files were not deleted.`, 10000);
      return;
    }

    this.setStatus("Writing archive and training data...");
    await this.archive.finalizeBeforeApply(
      job,
      attemptResult.finalContent,
      attemptResult.proposedAttempts.length,
      attemptResult.finalCoverage,
      attemptResult.finalJudge,
      inputs.mergeSystemPrompt,
      inputs.basePrompt,
      attemptResult.proposedAttempts,
    );

    this.setStatus("Applying merge...");
    await this.assertMergeInputsUnchanged(active, inputs.targetContent, inputs.sourceFiles, inputs.sourceContents);
    await this.app.vault.modify(active, this.ensureTrailingNewline(attemptResult.finalContent));
    const deletedSources = await this.cleanUpSourceExtractions(inputs.sourceExtractions);

    await this.archive.markApplied(job, deletedSources);
    this.setStatus("");
    new Notice(`Merged extracted lines from ${inputs.sourceFiles.length} note(s). Archive: ${job.id}`, 10000);
  }

  async autoMergeActive(): Promise<void> {
    if (!this.settings.autoMergeEnabled) {
      new Notice("Enable auto-merge in Zettel Merge AI settings first.");
      return;
    }
    const active = requireActiveMarkdownFile(this.app);
    const suggestions = await this.suggestForActive(false);
    const auto = suggestions.filter(suggestion => suggestion.decision.confidence >= this.settings.autoMergeThreshold);
    if (!auto.length) {
      new Notice("No candidates met the auto-merge threshold.");
      return;
    }
    await this.mergeIntoActive(active, auto);
  }

  async clearEmbeddingCache(): Promise<void> {
    const index = new EmbeddingIndex(this.app, this.settings, this.client);
    await index.clear();
    new Notice("Zettel Merge AI embedding cache cleared. Run suggestions to rebuild it.");
  }

  async buildFullEmbeddingIndex(): Promise<void> {
    const index = new EmbeddingIndex(this.app, this.settings, this.client);
    this.setStatus("Building full embedding index...");
    const total = await index.buildFullIndex(text => this.setStatus(text));
    this.setStatus("");
    new Notice(`Full embedding index built for ${total} note(s).`, 10000);
  }

  async restoreLatestAppliedMerge(): Promise<void> {
    const jobId = await this.archive.restoreLatestApplied();
    new Notice(`Restored merge job ${jobId}.`, 10000);
  }

  private async loadMergeInputs(active: TFile, suggestions: MergeSuggestion[]): Promise<MergeInputs> {
    const sourceFiles = suggestions.map(suggestion => suggestion.file);
    const targetContent = await this.app.vault.read(active);
    const sourceContents = await Promise.all(sourceFiles.map(file => this.app.vault.read(file)));
    const decisions = suggestions.map(suggestion => suggestion.decision);
    const sourceExtractions = suggestions.map((suggestion, index) =>
      buildSourceExtraction(suggestion.file, sourceContents[index], suggestion.decision.sourceLineRanges),
    );
    const extractedSourceContents = sourceExtractions.map(extraction => extraction.extractedContent);
    const mergeSystemPrompt = scopedMergeSystemPrompt(this.settings);

    return {
      sourceFiles,
      targetContent,
      sourceContents,
      decisions,
      sourceExtractions,
      sourceMaterial: [targetContent, ...extractedSourceContents].join("\n\n--- SOURCE BREAK ---\n\n"),
      mergeSystemPrompt,
      basePrompt: buildMergeUserPrompt(active.path, targetContent, sourceExtractions, this.settings.maxMergeInputChars),
    };
  }

  private async runScopedMergeAttempts(job: MergeJob, inputs: MergeInputs): Promise<MergeAttemptResult> {
    const proposedAttempts: string[] = [];
    let finalContent = "";
    let finalCoverage: CoverageReport | null = null;
    let finalJudge: JudgeResult | null = null;
    let hint = "";

    for (let attempt = 1; attempt <= this.settings.maxMergeRetries; attempt++) {
      this.setStatus(`Merging attempt ${attempt}/${this.settings.maxMergeRetries}...`);
      const prompt = hint ? `${inputs.basePrompt}\n\nRETRY REQUIREMENTS:\n${hint}` : inputs.basePrompt;
      const rawPlan = await this.client.chatJson<ScopedMergePlanResponse>([
        { role: "system", content: inputs.mergeSystemPrompt },
        { role: "user", content: prompt },
      ], { temperature: 0 });
      const plan = normalizeScopedMergePlan(rawPlan, inputs.targetContent);
      const proposed = applyScopedMergePlan(inputs.targetContent, plan);
      proposedAttempts.push(proposed);
      await this.archive.writeProposed(job, attempt, formatScopedMergeAttempt(plan, proposed));

      this.setStatus(`Validating attempt ${attempt}/${this.settings.maxMergeRetries}...`);
      const coverage = buildCoverageReport(inputs.sourceMaterial, proposed);
      const judge = await this.judgeMergedOutput(inputs.sourceMaterial, proposed);

      finalContent = proposed;
      finalCoverage = coverage;
      finalJudge = judge;

      if (this.isValidated(coverage, judge)) break;

      hint = formatMissingForRetry(coverage, judge.missing_facts);
      if (!hint) hint = "The validator failed. Re-check all source facts and preserve every missing or transformed detail.";
    }

    if (!finalCoverage || !finalJudge) throw new Error("Merge produced no validation result.");
    return { finalContent, finalCoverage, finalJudge, proposedAttempts };
  }

  private async judgeCandidates(active: TFile, activeContent: string, candidates: SimilarCandidate[]): Promise<MergeSuggestion[]> {
    const visibleLineLimits = new Map<string, number>();
    const payload = candidates.map((candidate, index) => {
      const excerpt = numberedExcerpt(candidate.file.path, candidate.content, this.settings.candidateJudgeChars);
      visibleLineLimits.set(candidate.file.path, excerpt.lastLine);
      return {
        id: index + 1,
        path: candidate.file.path,
        similarity: Number(candidate.similarity.toFixed(4)),
        numbered_excerpt: excerpt.text,
      };
    });

    const response = await this.client.chatJson<Partial<DecisionsResponse>>([
      {
        role: "system",
        content: this.suggestionSystemPrompt(),
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
              relationship: "one allowed relationship value",
              risk: "low, medium, or high",
              reason: "short reason",
              source_line_ranges: [{
                start_line: "1-based inclusive start line from the candidate numbered_excerpt",
                end_line: "1-based inclusive end line from the candidate numbered_excerpt",
                reason: "why these exact lines should be extracted",
              }],
            }],
          },
        }, null, 2),
      },
    ], { temperature: 0, model: this.settings.suggestionModel || this.settings.chatModel });

    const decisions = Array.isArray(response?.decisions) ? response.decisions : [];
    const byPath = new Map<string, RawMergeDecision>();
    for (const decision of decisions) {
      if (!decision || typeof decision !== "object") continue;
      if (typeof decision.path === "string") byPath.set(decision.path, decision);
    }

    return candidates
      .map(candidate => {
        const raw = byPath.get(candidate.file.path);
        if (!raw || raw.action !== "merge") return null;
        const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
        if (confidence < this.settings.reviewThreshold) return null;
        const relationship = this.normalizeRelationship(raw.relationship);
        if (!this.isMergeableRelationship(relationship)) return null;
        if (!this.isBroadTopicMode()
          && (relationship === "direct_subsection" || relationship === "definition_expansion")
          && confidence < 0.9) return null;
        const sourceLineRanges = normalizeSourceLineRanges(
          raw.sourceLineRanges || raw.source_line_ranges || raw.extract_ranges,
          candidate.content,
          visibleLineLimits.get(candidate.file.path) || 0,
        );
        if (!sourceLineRanges.length) return null;
        const decision: MergeDecision = {
          path: candidate.file.path,
          action: "merge",
          confidence,
          reason: raw.reason || "Model marked this candidate as mergeable.",
          risk: raw.risk === "medium" || raw.risk === "high" ? raw.risk : "low",
          sourceLineRanges,
          relationship,
        };
        return { ...candidate, decision };
      })
      .filter((value): value is MergeSuggestion => value !== null)
      .sort((a, b) => b.decision.confidence - a.decision.confidence);
  }

  private suggestionSystemPrompt(): string {
    const common = [
      "Return JSON only.",
      "Allowed relationship values: duplicate, same_concept_fragment, direct_subsection, definition_expansion, broad_context, taxonomy, example_only, separate_concept, topic_mismatch.",
      "Do not suggest links. This workflow only merges or skips.",
      "Candidate notes are provided as numbered_excerpt blocks with 1-based line numbers.",
      "For every action=merge decision, include source_line_ranges. Each range must use exact inclusive line numbers from that candidate's numbered_excerpt.",
      "Extract only the lines that should actually be merged into the active note. Leave unrelated lines out.",
      "If no exact candidate lines should be extracted, return action=skip.",
    ];

    if (this.isBroadTopicMode()) {
      return [
        "You are a broad-topic Zettelkasten mergeability judge.",
        "The active note is a seed for a larger master note or chapter-level note.",
        "Goal: gather notes that belong under the same broad topic, institution, exam chapter, scheme, tax, act, movement, place, person, or conceptual family.",
        "Use action=merge when the candidate would naturally fit as a section/subsection/example inside the same master note.",
        "Use action=merge for duplicate, same_concept_fragment, direct_subsection, definition_expansion, broad_context, taxonomy, and example_only, but only when they share the same broad topic as the active note.",
        "Use action=skip for unrelated/separate concepts, accidental keyword overlap, different institutions, different policy areas, or topic_mismatch.",
        "Examples: If active note is about IMF tranches, IMF quota, SDR, IMF facilities, World Economic Outlook, and IMF origins can merge into an IMF master note; RBI CRR/SLR monetary policy should skip.",
        "Examples: If active note is about indirect taxes, excise/sales tax/GST/customs/VAT/CST/tax shifting can merge into an indirect taxation master note; unrelated fiscal deficit notes should skip.",
        "Confidence rules: same broad topic can be 0.85-0.95. Unrelated or merely keyword-overlapping candidates must be skip and below 0.75.",
        ...common,
      ].join("\n");
    }

    return [
      "You are a conservative Zettelkasten mergeability judge.",
      "Goal: prevent bloated notes. Related is not mergeable.",
      "Use action=merge only when the candidate is a duplicate, same-concept fragment, direct subsection of the active note's exact concept, or a definition/etymology expansion of the active note's exact primary term.",
      "Use action=skip for broad context, taxonomy/classification, history, examples-only, commodity-specific applications, parent/child context, same broad subject, or separate concepts.",
      "If the active note is narrow, do not merge broader overview notes into it.",
      "If merging would turn a narrow note into a large master note, skip.",
      "Confidence rules: only duplicate/same_concept_fragment can exceed 0.94. direct_subsection/definition_expansion should usually be 0.86-0.93. broad_context/taxonomy/example_only must be skip and below 0.75.",
      ...common,
    ].join("\n");
  }

  private normalizeRelationship(value: unknown): MergeDecision["relationship"] {
    const allowed: MergeDecision["relationship"][] = [
      "duplicate",
      "same_concept_fragment",
      "direct_subsection",
      "definition_expansion",
      "broad_context",
      "taxonomy",
      "example_only",
      "separate_concept",
      "topic_mismatch",
    ];
    return allowed.includes(value as MergeDecision["relationship"])
      ? value as MergeDecision["relationship"]
      : "separate_concept";
  }

  private isMergeableRelationship(relationship: MergeDecision["relationship"]): boolean {
    if (this.isBroadTopicMode()) {
      return relationship === "duplicate"
        || relationship === "same_concept_fragment"
        || relationship === "direct_subsection"
        || relationship === "definition_expansion"
        || relationship === "broad_context"
        || relationship === "taxonomy"
        || relationship === "example_only";
    }

    return relationship === "duplicate"
      || relationship === "same_concept_fragment"
      || relationship === "direct_subsection"
      || relationship === "definition_expansion";
  }

  private isBroadTopicMode(): boolean {
    return this.settings.suggestionMode === "broad_topic";
  }

  private async judgeMergedOutput(sourceMaterial: string, candidate: string): Promise<JudgeResult> {
    const response = await this.client.chatJson<Partial<JudgeResult> | null>([
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
      verdict: response?.verdict === "pass" ? "pass" : "fail",
      score: typeof response?.score === "number" ? response.score : 0,
      missing_facts: Array.isArray(response?.missing_facts) ? response.missing_facts.map(String) : [],
      unsupported_additions: Array.isArray(response?.unsupported_additions) ? response.unsupported_additions.map(String) : [],
      notes: response?.notes || "",
    };
  }

  private async assertMergeInputsUnchanged(
    active: TFile,
    targetContent: string,
    sourceFiles: TFile[],
    sourceContents: string[],
  ): Promise<void> {
    const currentTarget = await this.app.vault.read(active);
    if (sha256(currentTarget) !== sha256(targetContent)) {
      throw new Error(`Active note changed before apply: ${active.path}. Run suggestions again.`);
    }

    for (let i = 0; i < sourceFiles.length; i++) {
      const currentSource = await this.app.vault.read(sourceFiles[i]);
      if (sha256(currentSource) !== sha256(sourceContents[i])) {
        throw new Error(`Source note changed before apply: ${sourceFiles[i].path}. Run suggestions again.`);
      }
    }
  }

  private async cleanUpSourceExtractions(sourceExtractions: SourceExtraction[]): Promise<string[]> {
    const deletedSources: string[] = [];
    if (!this.settings.deleteSourcesAfterMerge) return deletedSources;

    for (const extraction of sourceExtractions) {
      if (hasMeaningfulMarkdown(extraction.remainingContent)) {
        await this.app.vault.modify(
          extraction.file,
          this.ensureTrailingNewline(extraction.remainingContent),
        );
      } else {
        deletedSources.push(extraction.file.path);
        await this.app.vault.delete(extraction.file);
      }
    }

    return deletedSources;
  }

  private ensureTrailingNewline(content: string): string {
    return content.endsWith("\n") ? content : content + "\n";
  }

  private isValidated(coverage: CoverageReport, judge: JudgeResult): boolean {
    return coverage.requiredMissingCount === 0
      && coverage.score >= this.settings.validationThreshold
      && judge.verdict === "pass"
      && judge.score >= this.settings.validationThreshold
      && judge.unsupported_additions.length === 0;
  }

  private isInMergeScope(file: TFile): boolean {
    return isVisibleMarkdownInScope(file, this.settings.rootFolder, this.settings.dataFolder);
  }
}
