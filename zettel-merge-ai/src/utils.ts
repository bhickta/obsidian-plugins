import { App, normalizePath, TFile } from "obsidian";
import { createHash } from "crypto";
import { CoverageReport, TraceItems } from "./types";

export function normalizeFolder(path: string): string {
  return normalizePath(path || "").replace(/^\/+|\/+$/g, "");
}

export function isInFolder(file: TFile, folder: string): boolean {
  const root = normalizeFolder(folder);
  if (!root) return true;
  return file.path === root || file.path.startsWith(root + "/");
}

export function isVisibleMarkdownInScope(file: TFile, rootFolder: string, dataFolder: string): boolean {
  if (file.extension !== "md") return false;
  if (!isInFolder(file, rootFolder)) return false;
  const dataRoot = normalizeFolder(dataFolder);
  return !dataRoot || !file.path.startsWith(dataRoot + "/");
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "note";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function stripMarkdownFence(text: string): string {
  let out = text.trim();
  if (out.startsWith("```markdown")) out = out.slice("```markdown".length).trim();
  else if (out.startsWith("```")) out = out.slice(3).trim();
  if (out.endsWith("```")) out = out.slice(0, -3).trim();
  return out.trim();
}

export function extractJson<T>(text: string): T {
  let raw = text.trim();
  if (raw.startsWith("```json")) raw = raw.slice("```json".length).trim();
  else if (raw.startsWith("```")) raw = raw.slice(3).trim();
  if (raw.endsWith("```")) raw = raw.slice(0, -3).trim();

  try {
    return JSON.parse(raw) as T;
  } catch {
    const firstObj = raw.indexOf("{");
    const lastObj = raw.lastIndexOf("}");
    if (firstObj >= 0 && lastObj > firstObj) {
      return JSON.parse(raw.slice(firstObj, lastObj + 1)) as T;
    }
    const firstArr = raw.indexOf("[");
    const lastArr = raw.lastIndexOf("]");
    if (firstArr >= 0 && lastArr > firstArr) {
      return JSON.parse(raw.slice(firstArr, lastArr + 1)) as T;
    }
    throw new Error("Model did not return valid JSON.");
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (await app.vault.adapter.exists(current, true)) continue;
    try {
      await app.vault.adapter.mkdir(current);
    } catch (error) {
      if (!(await app.vault.adapter.exists(current, true))) throw error;
    }
  }
}

export async function writeText(app: App, path: string, content: string): Promise<void> {
  const normalized = normalizePath(path);
  const folder = normalized.substring(0, normalized.lastIndexOf("/"));
  if (folder) await ensureFolder(app, folder);
  await app.vault.adapter.write(normalized, content);
}

export async function appendText(app: App, path: string, content: string): Promise<void> {
  const normalized = normalizePath(path);
  const folder = normalized.substring(0, normalized.lastIndexOf("/"));
  if (folder) await ensureFolder(app, folder);
  if (await app.vault.adapter.exists(normalized, true)) await app.vault.adapter.append(normalized, content);
  else await app.vault.adapter.write(normalized, content);
}

export async function readText(app: App, path: string): Promise<string> {
  const normalized = normalizePath(path);
  return await app.vault.adapter.read(normalized);
}

export async function readJson<T>(app: App, path: string, fallback: T): Promise<T> {
  const normalized = normalizePath(path);
  if (!(await app.vault.adapter.exists(normalized, true))) return fallback;
  try {
    return JSON.parse(await app.vault.adapter.read(normalized)) as T;
  } catch {
    return fallback;
  }
}

export function compactNote(path: string, content: string, maxChars: number): string {
  const headings = extractHeadings(content).slice(0, 20);
  const excerpt = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim().slice(0, maxChars);
  return [
    `PATH: ${path}`,
    headings.length ? `HEADINGS:\n${headings.map(h => `- ${h}`).join("\n")}` : "",
    `EXCERPT:\n${excerpt}`
  ].filter(Boolean).join("\n\n");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function collect(pattern: RegExp, text: string, group = 0): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    out.push(match[group] || match[0]);
  }
  return out;
}

function extractHeadings(text: string): string[] {
  return unique(text.split("\n")
    .map(line => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim() || "")
    .filter(Boolean));
}

export function extractTraceItems(text: string): TraceItems {
  const links = collect(/\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g, text, 1);
  const tags = collect(/(^|\s)#([A-Za-z0-9_/-]+)/g, text, 2).map(t => `#${t}`);
  const dates = collect(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi, text, 0);
  const numbers = collect(/\b\d+(?:[.,]\d+)*(?:\.\d+)?(?:%|[a-zA-Z]+)?\b/g, text, 0);
  const headings = extractHeadings(text);
  const uniqueLines = unique(text.split("\n")
    .map(line => line.replace(/^[-*+]\s+/, "").trim())
    .filter(line => line.length >= 28 && !line.startsWith("```") && !/^#{1,6}\s/.test(line)));

  return {
    links: unique(links),
    tags: unique(tags),
    dates: unique(dates),
    numbers: unique(numbers),
    headings,
    uniqueLines,
  };
}

function missing(source: string[], finalContent: string): string[] {
  const haystack = finalContent.toLowerCase();
  return source.filter(item => !haystack.includes(item.toLowerCase()));
}

export function buildCoverageReport(sourceContent: string, finalContent: string): CoverageReport {
  const trace = extractTraceItems(sourceContent);
  const missingLinks = missing(trace.links, finalContent);
  const missingTags = missing(trace.tags, finalContent);
  const missingDates = missing(trace.dates, finalContent);
  const missingNumbers = missing(trace.numbers, finalContent);
  const missingHeadings = missing(trace.headings, finalContent);
  const missingUniqueLines = missing(trace.uniqueLines, finalContent);

  const totalRequired = trace.links.length + trace.tags.length + trace.dates.length + trace.numbers.length + trace.headings.length;
  const missingRequired = missingLinks.length + missingTags.length + missingDates.length + missingNumbers.length + missingHeadings.length;
  const score = totalRequired === 0 ? 1 : Math.max(0, (totalRequired - missingRequired) / totalRequired);

  return {
    score,
    requiredMissingCount: missingRequired,
    missing_links: missingLinks,
    missing_tags: missingTags,
    missing_dates: missingDates,
    missing_numbers: missingNumbers,
    missing_headings: missingHeadings,
    missing_unique_lines: missingUniqueLines.slice(0, 200),
  };
}

export function formatMissingForRetry(coverage: CoverageReport, missingFacts: string[]): string {
  const parts: string[] = [];
  if (coverage.missing_links.length) parts.push(`Missing wikilinks: ${coverage.missing_links.join(", ")}`);
  if (coverage.missing_tags.length) parts.push(`Missing tags: ${coverage.missing_tags.join(", ")}`);
  if (coverage.missing_dates.length) parts.push(`Missing dates: ${coverage.missing_dates.join(", ")}`);
  if (coverage.missing_numbers.length) parts.push(`Missing numbers: ${coverage.missing_numbers.join(", ")}`);
  if (coverage.missing_headings.length) parts.push(`Missing headings: ${coverage.missing_headings.join(", ")}`);
  if (missingFacts.length) parts.push(`Judge missing facts: ${missingFacts.join(" | ")}`);
  return parts.join("\n");
}
