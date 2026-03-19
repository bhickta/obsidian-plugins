import { MASTER_PROMPT, DEFAULT_JUDGE_PROMPT } from "../prompts";

export interface PluginSettings {
  geminiApiKey: string;
  geminiApiKeys: string;
  failedKeys: Record<string, number>;
  mergerModel: string;
  judgeModel: string;
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
  failedKeys: {},
  mergerModel: "gemini-3.1-pro-preview",
  judgeModel: "",
  autoApproveThreshold: 1,
  enableJudge: false,
  trainingDataPath: "_training/dataset.jsonl",
  deleteSourceAfterMerge: false,
  maxRetries: 1,
  enableAutoRename: true,
  mergerPrompt: MASTER_PROMPT,
  judgePrompt: DEFAULT_JUDGE_PROMPT,
};
