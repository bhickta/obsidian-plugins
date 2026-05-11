import { App, normalizePath, TFile } from "obsidian";
import {
  ArchiveFileEntry,
  CoverageReport,
  JudgeResult,
  MergeDecision,
  MergeJob,
  MergeJobManifest,
  ZettelMergeSettings,
} from "./types";
import { appendText, byteLength, readJson, readText, sanitizeFileName, sha256, writeText } from "./utils";

interface JobIndexEntry {
  job_id: string;
  created_at: string;
  applied_at?: string;
  restored_at?: string;
  status: MergeJobManifest["status"];
  target_path: string;
  source_paths: string[];
}

interface RollbackRecord {
  job_id: string;
  target: ArchiveFileEntry;
  sources: ArchiveFileEntry[];
  created_files: string[];
  deleted_sources: string[];
}

export class ArchiveStore {
  constructor(private app: App, private settings: ZettelMergeSettings) {}

  async createJob(
    target: TFile,
    sourceFiles: TFile[],
    targetContent: string,
    sourceContents: string[],
    decisions: MergeDecision[],
  ): Promise<MergeJob> {
    const id = this.createJobId();
    const basePath = normalizePath(`${this.settings.dataFolder}/jobs/${id}`);

    const targetArchive = `originals/target-${sanitizeFileName(target.basename)}.md`;
    await writeText(this.app, `${basePath}/${targetArchive}`, targetContent);

    const sourceEntries: ArchiveFileEntry[] = [];
    for (let i = 0; i < sourceFiles.length; i++) {
      const file = sourceFiles[i];
      const content = sourceContents[i];
      const archivePath = `originals/source-${String(i + 1).padStart(3, "0")}-${sanitizeFileName(file.basename)}.md`;
      await writeText(this.app, `${basePath}/${archivePath}`, content);
      sourceEntries.push(this.entry("source", file.path, archivePath, content));
    }

    const manifest: MergeJobManifest = {
      job_id: id,
      created_at: new Date().toISOString(),
      status: "created",
      target_file: this.entry("target", target.path, targetArchive, targetContent),
      source_files: sourceEntries,
      final_files: [],
      model_chat: this.settings.chatModel,
      model_embedding: this.settings.embeddingModel,
      attempts: 0,
      decisions,
    };

    const job = { id, basePath, manifest };
    await this.writeManifest(job);
    await this.updateIndex(job);
    return job;
  }

  async writeProposed(job: MergeJob, attempt: number, content: string): Promise<void> {
    await writeText(this.app, `${job.basePath}/proposed/attempt-${String(attempt).padStart(2, "0")}.md`, content);
  }

  async writeQuality(job: MergeJob, coverage: CoverageReport, judge: JudgeResult): Promise<void> {
    await writeText(this.app, `${job.basePath}/quality/coverage.json`, JSON.stringify(coverage, null, 2));
    await writeText(this.app, `${job.basePath}/quality/judge.json`, JSON.stringify(judge, null, 2));
  }

  async writeComparison(job: MergeJob, coverage: CoverageReport, judge: JudgeResult): Promise<void> {
    const lines = [
      "# Merge Comparison",
      "",
      `Job: ${job.id}`,
      `Target: ${job.manifest.target_file.original_path}`,
      "",
      "## Sources",
      ...job.manifest.source_files.map(file => `- ${file.original_path}`),
      "",
      "## Quality",
      `- Coverage score: ${coverage.score.toFixed(4)}`,
      `- Judge score: ${judge.score.toFixed(4)}`,
      `- Judge verdict: ${judge.verdict}`,
      "",
      "## Required Missing Items",
      ...this.missingLines(coverage),
      "",
      "## Judge Missing Facts",
      ...(judge.missing_facts.length ? judge.missing_facts.map(f => `- ${f}`) : ["None"]),
      "",
      "## Unsupported Additions",
      ...(judge.unsupported_additions.length ? judge.unsupported_additions.map(f => `- ${f}`) : ["None"]),
      "",
    ];
    await writeText(this.app, `${job.basePath}/quality/comparison.md`, lines.join("\n"));
  }

  async finalizeBeforeApply(
    job: MergeJob,
    finalContent: string,
    attempts: number,
    coverage: CoverageReport,
    judge: JudgeResult,
    mergeUserPrompt: string,
    proposedAttempts: string[],
  ): Promise<void> {
    const finalArchivePath = `final/${sanitizeFileName(job.manifest.target_file.original_path.replace(/\.md$/i, ""))}.md`;
    await writeText(this.app, `${job.basePath}/${finalArchivePath}`, finalContent);

    job.manifest.attempts = attempts;
    job.manifest.final_files = [{
      path: job.manifest.target_file.original_path,
      archive_path: finalArchivePath,
      sha256: sha256(finalContent),
      bytes: byteLength(finalContent),
    }];
    job.manifest.quality = {
      coverage_score: coverage.score,
      judge_score: judge.score,
      judge_verdict: judge.verdict,
      required_missing_count: coverage.requiredMissingCount,
    };

    await this.writeQuality(job, coverage, judge);
    await this.writeComparison(job, coverage, judge);
    await this.writeRollback(job, []);
    await this.writeTraining(job, finalContent, mergeUserPrompt, judge, coverage, proposedAttempts);
    await this.writeManifest(job);
    await this.updateIndex(job);
  }

  async markApplied(job: MergeJob, deletedSources: string[]): Promise<void> {
    job.manifest.status = "applied";
    job.manifest.applied_at = new Date().toISOString();
    await this.writeRollback(job, deletedSources);
    await this.writeManifest(job);
    await this.updateIndex(job);
  }

  async markFailedValidation(job: MergeJob, attempts: number, coverage: CoverageReport, judge: JudgeResult): Promise<void> {
    job.manifest.status = "failed_validation";
    job.manifest.attempts = attempts;
    job.manifest.quality = {
      coverage_score: coverage.score,
      judge_score: judge.score,
      judge_verdict: judge.verdict,
      required_missing_count: coverage.requiredMissingCount,
    };
    await this.writeQuality(job, coverage, judge);
    await this.writeComparison(job, coverage, judge);
    await this.writeManifest(job);
    await this.updateIndex(job);
  }

  async restoreLatestApplied(): Promise<string> {
    const index = await this.readIndex();
    const latest = [...index].reverse().find(entry => entry.status === "applied");
    if (!latest) throw new Error("No applied merge job found.");

    const basePath = normalizePath(`${this.settings.dataFolder}/jobs/${latest.job_id}`);
    const rollback = await readJson<RollbackRecord | null>(this.app, `${basePath}/rollback.json`, null);
    if (!rollback) throw new Error(`Rollback metadata missing for ${latest.job_id}.`);

    await this.restoreEntry(basePath, rollback.target);
    for (const source of rollback.sources) await this.restoreEntry(basePath, source);

    const manifest = await readJson<MergeJobManifest | null>(this.app, `${basePath}/manifest.json`, null);
    if (manifest) {
      manifest.status = "restored";
      manifest.restored_at = new Date().toISOString();
      await writeText(this.app, `${basePath}/manifest.json`, JSON.stringify(manifest, null, 2));
      await this.updateIndex({ id: manifest.job_id, basePath, manifest });
    }

    return latest.job_id;
  }

  private async writeTraining(
    job: MergeJob,
    finalContent: string,
    mergeUserPrompt: string,
    judge: JudgeResult,
    coverage: CoverageReport,
    proposedAttempts: string[],
  ): Promise<void> {
    const metadata = {
      job_id: job.id,
      source_paths: job.manifest.source_files.map(file => file.original_path),
      target_path: job.manifest.target_file.original_path,
      source_hashes: job.manifest.source_files.map(file => file.sha256),
      target_hash: job.manifest.target_file.sha256,
      final_hash: sha256(finalContent),
      judge_score: judge.score,
      judge_verdict: judge.verdict,
      coverage_score: coverage.score,
      attempts: job.manifest.attempts,
      model_chat: this.settings.chatModel,
    };

    const sft = {
      messages: [
        { role: "system", content: this.settings.mergeSystemPrompt },
        { role: "user", content: mergeUserPrompt },
        { role: "assistant", content: finalContent },
      ],
      metadata,
    };
    const judgeRecord = {
      source: mergeUserPrompt,
      candidate: finalContent,
      verdict: judge.verdict,
      score: judge.score,
      missing_facts: judge.missing_facts,
      unsupported_additions: judge.unsupported_additions,
      coverage,
      metadata,
    };

    await this.appendTraining(job, "sft", sft);
    await this.appendTraining(job, "judge", judgeRecord);

    if (proposedAttempts.length > 1 && proposedAttempts[0] !== finalContent) {
      await this.appendTraining(job, "preference", {
        prompt: mergeUserPrompt,
        chosen: finalContent,
        rejected: proposedAttempts[0],
        metadata,
      });
    }
  }

  private async appendTraining(job: MergeJob, kind: "sft" | "judge" | "preference", record: unknown): Promise<void> {
    const line = JSON.stringify(record) + "\n";
    await appendText(this.app, `${job.basePath}/training/${kind}.jsonl`, line);
    await appendText(this.app, `${this.settings.dataFolder}/datasets/${kind}.jsonl`, line);
  }

  private async restoreEntry(basePath: string, entry: ArchiveFileEntry): Promise<void> {
    const archivePath = `${basePath}/${entry.archive_path}`;
    if (!(await this.app.vault.adapter.exists(normalizePath(archivePath), true))) {
      throw new Error(`Missing archive file: ${entry.archive_path}`);
    }
    const content = await readText(this.app, archivePath);
    await writeText(this.app, entry.original_path, content);
  }

  private async writeRollback(job: MergeJob, deletedSources: string[]): Promise<void> {
    const rollback: RollbackRecord = {
      job_id: job.id,
      target: job.manifest.target_file,
      sources: job.manifest.source_files,
      created_files: job.manifest.final_files.map(file => file.path),
      deleted_sources: deletedSources,
    };
    await writeText(this.app, `${job.basePath}/rollback.json`, JSON.stringify(rollback, null, 2));
  }

  private missingLines(coverage: CoverageReport): string[] {
    const rows = [
      ["Links", coverage.missing_links],
      ["Tags", coverage.missing_tags],
      ["Dates", coverage.missing_dates],
      ["Numbers", coverage.missing_numbers],
      ["Headings", coverage.missing_headings],
    ];
    const out: string[] = [];
    for (const [label, items] of rows) {
      const values = items as string[];
      if (values.length) out.push(`- ${label}: ${values.join(", ")}`);
    }
    return out.length ? out : ["None"];
  }

  private entry(role: "target" | "source", originalPath: string, archivePath: string, content: string): ArchiveFileEntry {
    return {
      role,
      original_path: originalPath,
      archive_path: archivePath,
      sha256: sha256(content),
      bytes: byteLength(content),
    };
  }

  private async writeManifest(job: MergeJob): Promise<void> {
    await writeText(this.app, `${job.basePath}/manifest.json`, JSON.stringify(job.manifest, null, 2));
  }

  private async readIndex(): Promise<JobIndexEntry[]> {
    return await readJson<JobIndexEntry[]>(this.app, `${this.settings.dataFolder}/jobs/index.json`, []);
  }

  private async updateIndex(job: MergeJob): Promise<void> {
    const index = await this.readIndex();
    const entry: JobIndexEntry = {
      job_id: job.id,
      created_at: job.manifest.created_at,
      applied_at: job.manifest.applied_at,
      restored_at: job.manifest.restored_at,
      status: job.manifest.status,
      target_path: job.manifest.target_file.original_path,
      source_paths: job.manifest.source_files.map(file => file.original_path),
    };
    const existing = index.findIndex(item => item.job_id === job.id);
    if (existing >= 0) index[existing] = entry;
    else index.push(entry);
    await writeText(this.app, `${this.settings.dataFolder}/jobs/index.json`, JSON.stringify(index, null, 2));
  }

  private createJobId(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rand = Math.random().toString(36).slice(2, 8);
    return `${stamp}_${rand}`;
  }
}
