import { requestUrl } from "obsidian";
import { ChatMessage, ZettelMergeSettings } from "./types";
import { extractJson } from "./utils";

interface ChatOptions {
  temperature?: number;
}

export interface OpenAIModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export class OpenAICompatibleClient {
  constructor(private settings: ZettelMergeSettings) {}

  private endpoint(path: string): string {
    const base = this.settings.baseUrl.replace(/\/+$/, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.settings.apiKey.trim()) headers.Authorization = `Bearer ${this.settings.apiKey.trim()}`;
    return headers;
  }

  private async requestJson(path: string, method: string, body?: unknown): Promise<any> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method,
      headers: this.headers(),
      contentType: "application/json",
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    });

    if (res.status < 200 || res.status >= 300) {
      const text = res.text || JSON.stringify(res.json || {});
      throw new Error(`[${res.status}] ${text}`);
    }
    return res.json;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const data = await this.requestJson(
      "/chat/completions",
      "POST",
      {
        model: this.settings.chatModel,
        messages,
        temperature: options.temperature ?? 0,
      },
    );
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Chat response did not include message content.");
    return content;
  }

  async chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const content = await this.chat(messages, options);
    return extractJson<T>(content);
  }

  async embedding(input: string): Promise<number[]> {
    const data = await this.requestJson(
      "/embeddings",
      "POST",
      {
        model: this.settings.embeddingModel,
        input,
      },
    );
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error("Embedding response did not include data[0].embedding.");
    return embedding.map(Number);
  }

  async listModels(): Promise<string[]> {
    return (await this.listModelInfos()).map(model => model.id);
  }

  async listModelInfos(): Promise<OpenAIModelInfo[]> {
    const data = await this.requestJson("/models", "GET");
    return (data.data || [])
      .map((model: any) => ({
        id: String(model.id || ""),
        object: typeof model.object === "string" ? model.object : undefined,
        owned_by: typeof model.owned_by === "string" ? model.owned_by : undefined,
        type: typeof model.type === "string" ? model.type : undefined,
        metadata: model.metadata && typeof model.metadata === "object" ? model.metadata : undefined,
      }))
      .filter((model: OpenAIModelInfo) => Boolean(model.id));
  }
}
