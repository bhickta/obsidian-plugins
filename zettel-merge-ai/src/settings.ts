import { DEFAULT_SETTINGS, ZettelMergeSettings } from "./types";

type NumberSettingKey =
  | "candidateLimit"
  | "maxFilesToScan"
  | "embeddingBatchSize"
  | "embeddingIndexSaveEvery"
  | "embeddingYieldEvery"
  | "embeddingProgressIntervalSeconds"
  | "reviewThreshold"
  | "autoMergeThreshold"
  | "validationThreshold"
  | "maxMergeRetries"
  | "embeddingSourceChars"
  | "candidateJudgeChars"
  | "maxMergeInputChars";

export interface NumberSettingLimit {
  min: number;
  max: number;
  step: number;
}

export const NUMBER_SETTING_LIMITS: Record<NumberSettingKey, NumberSettingLimit> = {
  candidateLimit: { min: 1, max: 50, step: 1 },
  maxFilesToScan: { min: 10, max: 5000, step: 1 },
  embeddingBatchSize: { min: 1, max: 1024, step: 1 },
  embeddingIndexSaveEvery: { min: 10, max: 1000, step: 1 },
  embeddingYieldEvery: { min: 1, max: 200, step: 1 },
  embeddingProgressIntervalSeconds: { min: 1, max: 120, step: 1 },
  reviewThreshold: { min: 0, max: 1, step: 0.01 },
  autoMergeThreshold: { min: 0, max: 1, step: 0.01 },
  validationThreshold: { min: 0, max: 1, step: 0.01 },
  maxMergeRetries: { min: 1, max: 5, step: 1 },
  embeddingSourceChars: { min: 500, max: 20000, step: 1 },
  candidateJudgeChars: { min: 500, max: 10000, step: 1 },
  maxMergeInputChars: { min: 5000, max: 500000, step: 1 },
};

export function normalizeSettings(saved: unknown): ZettelMergeSettings {
  const raw = isRecord(saved) ? saved : {};
  const settings: ZettelMergeSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
  };

  settings.rootFolder = cleanString(raw.rootFolder, DEFAULT_SETTINGS.rootFolder);
  settings.dataFolder = cleanString(raw.dataFolder, DEFAULT_SETTINGS.dataFolder);
  settings.baseUrl = cleanString(raw.baseUrl, DEFAULT_SETTINGS.baseUrl);
  settings.apiKey = cleanString(raw.apiKey, DEFAULT_SETTINGS.apiKey);
  settings.chatModel = cleanString(raw.chatModel, DEFAULT_SETTINGS.chatModel);
  settings.suggestionModel = cleanString(raw.suggestionModel, settings.chatModel);
  settings.embeddingModel = cleanString(raw.embeddingModel, DEFAULT_SETTINGS.embeddingModel);
  settings.modelsRefreshedAt = cleanString(raw.modelsRefreshedAt, "");
  settings.mergeSystemPrompt = typeof raw.mergeSystemPrompt === "string"
    ? raw.mergeSystemPrompt
    : DEFAULT_SETTINGS.mergeSystemPrompt;

  settings.cachedChatModels = cleanStringArray(raw.cachedChatModels);
  settings.cachedEmbeddingModels = cleanStringArray(raw.cachedEmbeddingModels);
  settings.cachedModelIds = cleanStringArray(raw.cachedModelIds);

  settings.suggestionMode = raw.suggestionMode === "strict" || raw.suggestionMode === "broad_topic"
    ? raw.suggestionMode
    : DEFAULT_SETTINGS.suggestionMode;

  settings.autoSuggestOnOpen = cleanBoolean(raw.autoSuggestOnOpen, DEFAULT_SETTINGS.autoSuggestOnOpen);
  settings.autoMergeEnabled = cleanBoolean(raw.autoMergeEnabled, DEFAULT_SETTINGS.autoMergeEnabled);
  settings.deleteSourcesAfterMerge = cleanBoolean(raw.deleteSourcesAfterMerge, DEFAULT_SETTINGS.deleteSourcesAfterMerge);

  for (const key of Object.keys(NUMBER_SETTING_LIMITS) as NumberSettingKey[]) {
    const limit = NUMBER_SETTING_LIMITS[key];
    settings[key] = clampNumber(raw[key], DEFAULT_SETTINGS[key], limit.min, limit.max);
  }

  return settings;
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
