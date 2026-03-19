import { MASTER_PROMPT, DEFAULT_JUDGE_PROMPT } from "../prompts";

export interface PluginSettings {
  geminiApiKey: string;
  geminiApiKeys: string;
  apiKeys: string; // standard multi-provider keys
  provider: "gemini" | "zhipu" | "openai" | "custom";
  customBaseUrl: string;
  failedKeys: Record<string, number>;
  mergerModel: string;
  judgeModel: string;
  cachedModels: string[];
  autoApproveThreshold: number;
  enableJudge: boolean;
  trainingDataPath: string;
  deleteSourceAfterMerge: boolean;
  maxRetries: number;
  enableAutoRename: boolean;
  mergerPrompt: string;
  judgePrompt: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  geminiApiKey: "",
  geminiApiKeys: "",
  apiKeys: "",
  provider: "gemini",
  customBaseUrl: "https://api.openai.com/v1",
  failedKeys: {},
  mergerModel: "gemini-3.1-pro-preview",
  judgeModel: "",
  cachedModels: [],
  autoApproveThreshold: 1,
  enableJudge: false,
  trainingDataPath: "_training/dataset.jsonl",
  deleteSourceAfterMerge: false,
  maxRetries: 1,
  enableAutoRename: true,
  mergerPrompt: MASTER_PROMPT,
  judgePrompt: DEFAULT_JUDGE_PROMPT,
};
