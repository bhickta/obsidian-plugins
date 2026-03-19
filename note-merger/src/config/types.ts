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
  judgeModel: "gemini-2.5-flash-latest",
  autoApproveThreshold: 0.92,
  enableJudge: false,
  trainingDataPath: "_training/dataset.jsonl",
  deleteSourceAfterMerge: false,
  maxRetries: 3,
  enableAutoRename: true,
  mergerPrompt: MASTER_PROMPT,
  judgePrompt: DEFAULT_JUDGE_PROMPT,
};
