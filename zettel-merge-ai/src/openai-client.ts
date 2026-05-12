import { requestUrl } from "obsidian";
import { ChatMessage, ZettelMergeSettings } from "./types";
import { extractJson } from "./utils";

interface ChatOptions {
  temperature?: number;
  model?: string;
}

interface EmbeddingRow {
  embedding: number[];
  index?: number;
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

  private async requestJson(path: string, method: string, body?: unknown): Promise<unknown> {
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
    const data = asRecord(await this.requestJson(
      "/chat/completions",
      "POST",
      {
        model: options.model || this.settings.chatModel,
        messages,
        temperature: options.temperature ?? 0,
      },
    ));
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first.message);
    const content = message.content;
    if (typeof content !== "string") throw new Error("Chat response did not include message content.");
    return content;
  }

  async chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const content = await this.chat(messages, options);
    return extractJson<T>(content);
  }

  async embedding(input: string): Promise<number[]> {
    const embeddings = await this.embeddings([input]);
    return embeddings[0];
  }

  async embeddings(inputs: string[]): Promise<number[][]> {
    if (!inputs.length) return [];
    const data = asRecord(await this.requestJson(
      "/embeddings",
      "POST",
      {
        model: this.settings.embeddingModel,
        input: inputs.length === 1 ? inputs[0] : inputs,
      },
    ));
    const rows = Array.isArray(data.data) ? data.data : [];
    if (rows.length !== inputs.length) {
      throw new Error(`Embedding response returned ${rows.length} item(s) for ${inputs.length} input(s).`);
    }
    const parsedRows = rows.map(parseEmbeddingRow);
    const sorted = parsedRows.every(row => typeof row.index === "number")
      ? [...parsedRows].sort((a, b) => (a.index || 0) - (b.index || 0))
      : parsedRows;
    return sorted.map(row => {
      const vector = row.embedding.map(Number);
      if (vector.some(value => !Number.isFinite(value))) {
        throw new Error("Embedding response included a non-numeric vector value.");
      }
      return vector;
    });
  }

  async listModels(): Promise<string[]> {
    return (await this.listModelInfos()).map(model => model.id);
  }

  async listModelInfos(): Promise<OpenAIModelInfo[]> {
    const data = asRecord(await this.requestJson("/models", "GET"));
    const models = Array.isArray(data.data) ? data.data : [];
    return models
      .map(model => asRecord(model))
      .map(model => ({
        id: String(model.id || ""),
        object: typeof model.object === "string" ? model.object : undefined,
        owned_by: typeof model.owned_by === "string" ? model.owned_by : undefined,
        type: typeof model.type === "string" ? model.type : undefined,
        metadata: asOptionalRecord(model.metadata),
      }))
      .filter((model: OpenAIModelInfo) => Boolean(model.id));
  }
}

function parseEmbeddingRow(value: unknown): EmbeddingRow {
  const row = asRecord(value);
  if (!Array.isArray(row.embedding)) throw new Error("Embedding response did not include embedding arrays.");
  return {
    embedding: row.embedding.map(Number),
    index: typeof row.index === "number" ? row.index : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
