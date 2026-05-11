import { App, normalizePath, TFile } from "obsidian";
import { OpenAICompatibleClient } from "./openai-client";
import { SimilarCandidate, ZettelMergeSettings } from "./types";
import { compactNote, cosineSimilarity, isVisibleMarkdownInScope, readJson, sha256, writeText } from "./utils";

interface EmbeddingCacheItem {
  hash: string;
  embedding: number[];
  updated_at: string;
}

interface EmbeddingCache {
  version: 1;
  model: string;
  items: Record<string, EmbeddingCacheItem>;
}

export class EmbeddingIndex {
  private cachePath: string;

  constructor(
    private app: App,
    private settings: ZettelMergeSettings,
    private client: OpenAICompatibleClient,
  ) {
    this.cachePath = normalizePath(`${settings.dataFolder}/index/embeddings.json`);
  }

  async clear(): Promise<void> {
    await writeText(this.app, this.cachePath, JSON.stringify({ version: 1, model: this.settings.embeddingModel, items: {} }, null, 2));
  }

  async findSimilar(active: TFile, onProgress?: (text: string) => void): Promise<SimilarCandidate[]> {
    const activeContent = await this.app.vault.read(active);
    const activeEmbedding = await this.embeddingForText(active.path, activeContent, true, onProgress);

    let cache = await this.loadCache();
    const files = this.app.vault.getMarkdownFiles()
      .filter(file => file.path !== active.path)
      .filter(file => isVisibleMarkdownInScope(file, this.settings.rootFolder, this.settings.dataFolder))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, this.settings.maxFilesToScan);

    const scored: SimilarCandidate[] = [];
    let processed = 0;
    for (const file of files) {
      processed++;
      if (onProgress) onProgress(`Embedding ${processed}/${files.length}: ${file.basename}`);
      const content = await this.app.vault.read(file);
      const source = compactNote(file.path, content, this.settings.embeddingSourceChars);
      const hash = sha256(`${this.settings.embeddingModel}\n${source}`);
      let item = cache.items[file.path];
      if (!item || item.hash !== hash) {
        item = {
          hash,
          embedding: await this.client.embedding(source),
          updated_at: new Date().toISOString(),
        };
        cache.items[file.path] = item;
      }
      scored.push({
        file,
        content,
        similarity: cosineSimilarity(activeEmbedding, item.embedding),
        hash,
      });
    }

    await this.saveCache(cache);
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.candidateLimit);
  }

  private async embeddingForText(path: string, content: string, persist: boolean, onProgress?: (text: string) => void): Promise<number[]> {
    const source = compactNote(path, content, this.settings.embeddingSourceChars);
    const hash = sha256(`${this.settings.embeddingModel}\n${source}`);
    const cache = await this.loadCache();
    const cached = cache.items[path];
    if (cached && cached.hash === hash) return cached.embedding;
    if (onProgress) onProgress(`Embedding active note: ${path}`);
    const embedding = await this.client.embedding(source);
    if (persist) {
      cache.items[path] = { hash, embedding, updated_at: new Date().toISOString() };
      await this.saveCache(cache);
    }
    return embedding;
  }

  private async loadCache(): Promise<EmbeddingCache> {
    const fallback: EmbeddingCache = { version: 1, model: this.settings.embeddingModel, items: {} };
    const cache = await readJson<EmbeddingCache>(this.app, this.cachePath, fallback);
    if (cache.model !== this.settings.embeddingModel) return fallback;
    return cache;
  }

  private async saveCache(cache: EmbeddingCache): Promise<void> {
    await writeText(this.app, this.cachePath, JSON.stringify(cache, null, 2));
  }
}
