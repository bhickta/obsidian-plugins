import { CONTENT_MERGER_PROMPT } from "../prompts";

export interface PluginSettings {
  geminiApiKey: string;
  geminiApiKeys: string;
  apiKeys: string; // Deprecated, use providerApiKeys
  providerApiKeys: Record<string, string>; // Maps provider name to newline-separated keys
  provider: "gemini" | "zhipu" | "openai" | "groq" | "together" | "deepseek" | "openrouter" | "custom" | "minimax" | "kimi" | "qwen" | "mimo" | "webai";
  customBaseUrl: string;
  failedKeys: Record<string, number>;
  mergerModel: string;
  cachedModels: string[];
  autoApproveThreshold: number;
  trainingDataPath: string;
  deleteSourceAfterMerge: boolean;
  maxRetries: number;
  enableAutoRename: boolean;
  mergerPrompt: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  geminiApiKey: "",
  geminiApiKeys: "",
  apiKeys: "",
  providerApiKeys: {},
  provider: "gemini",
  customBaseUrl: "https://api.openai.com/v1",
  failedKeys: {},
  mergerModel: "gemini-3.1-pro-preview",
  cachedModels: [],
  autoApproveThreshold: 1,
  trainingDataPath: "_training/dataset.jsonl",
  deleteSourceAfterMerge: false,
  maxRetries: 1,
  enableAutoRename: true,
  mergerPrompt: CONTENT_MERGER_PROMPT,
};
