import { ChatMessage, ZettelMergeSettings } from "./types";
import { extractJson } from "./utils";

interface ChatOptions {
  temperature?: number;
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

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const res = await fetch(this.endpoint("/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.settings.chatModel,
        messages,
        temperature: options.temperature ?? 0,
      }),
    });

    if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Chat response did not include message content.");
    return content;
  }

  async chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const content = await this.chat(messages, options);
    return extractJson<T>(content);
  }

  async embedding(input: string): Promise<number[]> {
    const res = await fetch(this.endpoint("/embeddings"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.settings.embeddingModel,
        input,
      }),
    });

    if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
    const data = await res.json();
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error("Embedding response did not include data[0].embedding.");
    return embedding.map(Number);
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.endpoint("/models"), { headers: this.headers() });
    if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
    const data = await res.json();
    return (data.data || []).map((model: any) => String(model.id)).filter(Boolean);
  }
}
