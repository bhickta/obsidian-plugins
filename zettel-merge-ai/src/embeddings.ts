import { App, normalizePath, TFile } from "obsidian";
import { OpenAICompatibleClient } from "./openai-client";
import { SimilarCandidate, ZettelMergeSettings } from "./types";
import { compactNote, cosineSimilarity, isVisibleMarkdownInScope, normalizeFolder, readJson, sha256, writeText } from "./utils";

interface EmbeddingCacheItem {
  hash: string;
  embedding: number[];
  updated_at: string;
  mtime?: number;
  size?: number;
}

interface EmbeddingCache {
  version: 1;
  model: string;
  items: Record<string, EmbeddingCacheItem>;
  full_index?: {
    completed: boolean;
    root_folder: string;
    file_count: number;
    built_at: string;
  };
}

interface PendingEmbedding {
  file: TFile;
  source: string;
  hash: string;
  mtime: number;
  size: number;
}

interface PendingLiveScanEmbedding extends PendingEmbedding {
  content: string;
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

  async buildFullIndex(onProgress?: (text: string) => void): Promise<number> {
    const cache = await this.loadCache();
    const files = this.scopedFiles().sort((a, b) => a.path.localeCompare(b.path));
    const scopedPaths = new Set(files.map(file => file.path));
    const pending: PendingEmbedding[] = [];
    const saveEvery = Math.max(1, this.settings.embeddingIndexSaveEvery);
    const batchSize = Math.max(1, this.settings.embeddingBatchSize);
    const yieldEvery = Math.max(1, this.settings.embeddingYieldEvery);
    let processed = 0;
    let embedded = 0;
    let reused = 0;
    let lastProgressAt = 0;
    const progressIntervalMs = Math.max(1, this.settings.embeddingProgressIntervalSeconds) * 1000;

    const progress = (text: string, force = false) => {
      if (!onProgress) return;
      const now = Date.now();
      if (!force && now - lastProgressAt < progressIntervalMs) return;
      lastProgressAt = now;
      onProgress(text);
    };

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending.splice(0, pending.length);
      progress(`Embedding batch of ${batch.length} note(s)...`, true);
      const vectors = await this.embedBatch(batch.map(item => item.source));
      for (let i = 0; i < batch.length; i++) {
        cache.items[batch[i].file.path] = {
          hash: batch[i].hash,
          embedding: vectors[i],
          updated_at: new Date().toISOString(),
          mtime: batch[i].mtime,
          size: batch[i].size,
        };
      }
      embedded += batch.length;
    };

    for (const file of files) {
      processed++;
      progress(`Indexing ${processed}/${files.length}: ${file.path}`);
      const existing = cache.items[file.path];
      if (existing && existing.mtime === file.stat.mtime && existing.size === file.stat.size) {
        reused++;
        if (processed % yieldEvery === 0) await this.yieldToObsidian();
        continue;
      }

      const content = await this.app.vault.read(file);
      const source = compactNote(file.path, content, this.settings.embeddingSourceChars);
      const hash = sha256(`${this.settings.embeddingModel}\n${source}`);
      const item = cache.items[file.path];
      if (item && item.hash === hash) {
        item.mtime = file.stat.mtime;
        item.size = file.stat.size;
        reused++;
      } else {
        pending.push({ file, source, hash, mtime: file.stat.mtime, size: file.stat.size });
      }

      if (pending.length >= batchSize) await flush();
      if (processed % saveEvery === 0) {
        await this.saveCache(cache);
        progress(`Checkpoint saved: ${processed}/${files.length} scanned, ${embedded} embedded, ${reused} reused.`, true);
      }
      if (processed % yieldEvery === 0) await this.yieldToObsidian();
    }

    await flush();

    for (const path of Object.keys(cache.items)) {
      if (!scopedPaths.has(path)) delete cache.items[path];
    }

    cache.full_index = {
      completed: true,
      root_folder: normalizeFolder(this.settings.rootFolder),
      file_count: files.length,
      built_at: new Date().toISOString(),
    };
    await this.saveCache(cache);
    progress(`Indexed ${files.length} note(s): ${embedded} updated, ${reused} reused.`, true);
    return files.length;
  }

  async findSimilar(active: TFile, onProgress?: (text: string) => void): Promise<SimilarCandidate[]> {
    const activeContent = await this.app.vault.read(active);
    const activeEmbedding = await this.embeddingForText(active.path, activeContent, true, onProgress);

    const cache = await this.loadCache();
    const files = this.scopedFiles()
      .filter(file => file.path !== active.path);

    if (this.hasFullIndex(cache)) {
      const cached = await this.findFromCache(activeEmbedding, cache, files, onProgress);
      if (cached.length) return cached;
    }

    return await this.findWithLiveScan(activeEmbedding, cache, files, onProgress);
  }

  private async findFromCache(
    activeEmbedding: number[],
    cache: EmbeddingCache,
    files: TFile[],
    onProgress?: (text: string) => void,
  ): Promise<SimilarCandidate[]> {
    const scored = files
      .map(file => {
        const item = cache.items[file.path];
        if (!item) return null;
        return {
          file,
          similarity: cosineSimilarity(activeEmbedding, item.embedding),
          hash: item.hash,
        };
      })
      .filter((item): item is { file: TFile; similarity: number; hash: string } => item !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.candidateLimit);

    if (onProgress) onProgress(`Searching full embedding index (${scored.length}/${files.length} candidates loaded).`);

    const out: SimilarCandidate[] = [];
    for (const item of scored) {
      out.push({
        file: item.file,
        content: await this.app.vault.read(item.file),
        similarity: item.similarity,
        hash: item.hash,
      });
    }
    return out;
  }

  private async findWithLiveScan(
    activeEmbedding: number[],
    cache: EmbeddingCache,
    files: TFile[],
    onProgress?: (text: string) => void,
  ): Promise<SimilarCandidate[]> {
    const scanFiles = files
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, this.settings.maxFilesToScan);

    if (onProgress) {
      onProgress(`Full embedding index not built; checking latest ${scanFiles.length}/${files.length} notes.`);
    }

    const scored: SimilarCandidate[] = [];
    const pending: PendingLiveScanEmbedding[] = [];
    const batchSize = Math.max(1, this.settings.embeddingBatchSize);
    let processed = 0;
    let embedded = 0;
    let reused = 0;

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending.splice(0, pending.length);
      if (onProgress) onProgress(`Embedding live-scan batch of ${batch.length} note(s)...`);
      const vectors = await this.embedBatch(batch.map(item => item.source));
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const embedding = vectors[i];
        cache.items[item.file.path] = {
          hash: item.hash,
          embedding,
          updated_at: new Date().toISOString(),
          mtime: item.mtime,
          size: item.size,
        };
        scored.push({
          file: item.file,
          content: item.content,
          similarity: cosineSimilarity(activeEmbedding, embedding),
          hash: item.hash,
        });
      }
      embedded += batch.length;
    };

    for (const file of scanFiles) {
      processed++;
      if (onProgress) onProgress(`Checking live-scan cache ${processed}/${scanFiles.length}: ${file.basename}`);
      const content = await this.app.vault.read(file);
      const source = compactNote(file.path, content, this.settings.embeddingSourceChars);
      const hash = sha256(`${this.settings.embeddingModel}\n${source}`);
      let item = cache.items[file.path];
      if (!item || item.hash !== hash) {
        if (onProgress) onProgress(`Embedding new/changed note ${processed}/${scanFiles.length}: ${file.basename}`);
        pending.push({ file, content, source, hash, mtime: file.stat.mtime, size: file.stat.size });
        if (pending.length >= batchSize) await flush();
      } else {
        reused++;
        scored.push({
          file,
          content,
          similarity: cosineSimilarity(activeEmbedding, item.embedding),
          hash,
        });
      }
    }
    await flush();

    await this.saveCache(cache);
    if (onProgress) {
      onProgress(`Live-scan complete: ${scanFiles.length} checked, ${embedded} embedded, ${reused} reused.`);
    }
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.candidateLimit);
  }

  private scopedFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles()
      .filter(file => isVisibleMarkdownInScope(file, this.settings.rootFolder, this.settings.dataFolder));
  }

  private hasFullIndex(cache: EmbeddingCache): boolean {
    return Boolean(
      cache.full_index?.completed
      && cache.full_index.root_folder === normalizeFolder(this.settings.rootFolder)
      && cache.full_index.file_count > 0
    );
  }

  private async embedBatch(sources: string[]): Promise<number[][]> {
    try {
      return await this.client.embeddings(sources);
    } catch (error) {
      if (sources.length === 1) throw error;
      const vectors: number[][] = [];
      for (const source of sources) vectors.push(await this.client.embedding(source));
      return vectors;
    }
  }

  private async yieldToObsidian(): Promise<void> {
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
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
