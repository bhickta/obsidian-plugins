import { TFile } from "obsidian";

export interface ZettelMergeSettings {
  rootFolder: string;
  dataFolder: string;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  cachedChatModels: string[];
  cachedEmbeddingModels: string[];
  cachedModelIds: string[];
  modelsRefreshedAt: string;
  autoSuggestOnOpen: boolean;
  autoMergeEnabled: boolean;
  deleteSourcesAfterMerge: boolean;
  candidateLimit: number;
  maxFilesToScan: number;
  reviewThreshold: number;
  autoMergeThreshold: number;
  validationThreshold: number;
  maxMergeRetries: number;
  embeddingSourceChars: number;
  candidateJudgeChars: number;
  maxMergeInputChars: number;
  mergeSystemPrompt: string;
}

export const DEFAULT_MERGE_PROMPT = `You are a strict Zettelkasten note merger.

Merge source notes into the active note with zero information loss.

Rules:
- Preserve every fact, date, number, named entity, tag, wikilink, heading-level fact, quote, and qualifier from all inputs.
- Do not add external knowledge.
- De-duplicate only when facts are truly identical.
- Keep conflicting facts by showing both variants.
- Preserve the active note's core structure when practical.
- Output only the final merged Markdown note. No preamble, no analysis, no code fences.`;

export const DEFAULT_SETTINGS: ZettelMergeSettings = {
  rootFolder: "Zettelkasten",
  dataFolder: ".zettel-merge-ai",
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "",
  chatModel: "local-model",
  embeddingModel: "text-embedding-nomic-embed-text-v1.5",
  cachedChatModels: [],
  cachedEmbeddingModels: [],
  cachedModelIds: [],
  modelsRefreshedAt: "",
  autoSuggestOnOpen: true,
  autoMergeEnabled: false,
  deleteSourcesAfterMerge: true,
  candidateLimit: 12,
  maxFilesToScan: 300,
  reviewThreshold: 0.85,
  autoMergeThreshold: 0.95,
  validationThreshold: 0.98,
  maxMergeRetries: 2,
  embeddingSourceChars: 4000,
  candidateJudgeChars: 2500,
  maxMergeInputChars: 120000,
  mergeSystemPrompt: DEFAULT_MERGE_PROMPT,
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SimilarCandidate {
  file: TFile;
  content: string;
  similarity: number;
  hash: string;
}

export interface MergeDecision {
  path: string;
  action: "merge" | "skip";
  confidence: number;
  reason: string;
  risk: "low" | "medium" | "high";
}

export interface MergeSuggestion extends SimilarCandidate {
  decision: MergeDecision;
}

export interface TraceItems {
  links: string[];
  tags: string[];
  dates: string[];
  numbers: string[];
  headings: string[];
  uniqueLines: string[];
}

export interface CoverageReport {
  score: number;
  requiredMissingCount: number;
  missing_links: string[];
  missing_tags: string[];
  missing_dates: string[];
  missing_numbers: string[];
  missing_headings: string[];
  missing_unique_lines: string[];
}

export interface JudgeResult {
  verdict: "pass" | "fail";
  score: number;
  missing_facts: string[];
  unsupported_additions: string[];
  notes: string;
}

export interface ArchiveFileEntry {
  role: "target" | "source";
  original_path: string;
  archive_path: string;
  sha256: string;
  bytes: number;
}

export interface MergeJobManifest {
  job_id: string;
  created_at: string;
  applied_at?: string;
  restored_at?: string;
  status: "created" | "failed_validation" | "applied" | "restored";
  target_file: ArchiveFileEntry;
  source_files: ArchiveFileEntry[];
  final_files: Array<{ path: string; archive_path: string; sha256: string; bytes: number }>;
  model_chat: string;
  model_embedding: string;
  attempts: number;
  decisions: MergeDecision[];
  quality?: {
    coverage_score: number;
    judge_score: number;
    judge_verdict: string;
    required_missing_count: number;
  };
}

export interface MergeJob {
  id: string;
  basePath: string;
  manifest: MergeJobManifest;
}
