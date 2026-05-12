import type { TFile } from "obsidian";
import type { MergeLineRange, ScopedMergeInsertion, ScopedMergePlan, ZettelMergeSettings } from "./types";
import {
  extractLineRanges,
  formatLineRanges,
  removeLineRanges,
  splitMarkdownLines,
} from "./utils";

export interface NumberedExcerpt {
  text: string;
  lastLine: number;
}

export interface SourceExtraction {
  file: TFile;
  originalContent: string;
  extractedContent: string;
  remainingContent: string;
  ranges: MergeLineRange[];
}

export interface ScopedMergePlanResponse {
  insertions?: Array<Partial<ScopedMergeInsertion> & {
    after_line?: unknown;
  }>;
  notes?: unknown;
}

export function scopedMergeSystemPrompt(settings: ZettelMergeSettings): string {
  const guidance = settings.mergeSystemPrompt.trim();
  return [
    "You are a scoped Zettelkasten merge planner.",
    "Return JSON only.",
    "You receive the active note with 1-based line numbers and extracted source lines.",
    "Do not rewrite the active note.",
    "Return insertion operations only. Each insertion adds Markdown after an existing active-note line.",
    "Use after_line=0 only when the insertion belongs at the start of the active note.",
    "Do not edit, reorder, paraphrase, or remove existing active-note lines.",
    "Every source fact, date, number, name, qualifier, tag, wikilink, quote, and meaningful detail from the extracted lines must be present in the final note unless the active note already contains it.",
    "Do not use material from source lines that were not extracted.",
    "Do not add external knowledge.",
    "If user guidance conflicts with these scoped JSON rules, these scoped JSON rules win.",
    guidance ? `User merge guidance:\n${guidance}` : "",
  ].filter(Boolean).join("\n");
}

export function buildMergeUserPrompt(
  activePath: string,
  targetContent: string,
  sourceExtractions: SourceExtraction[],
  maxMergeInputChars: number,
): string {
  const sections = [
    `ACTIVE NOTE PATH: ${activePath}`,
    "ACTIVE NOTE CONTENT WITH LINE NUMBERS:",
    numberedNote(activePath, targetContent),
    "",
    "SOURCE LINES TO MERGE INTO ACTIVE NOTE:",
  ];
  for (let i = 0; i < sourceExtractions.length; i++) {
    const extraction = sourceExtractions[i];
    sections.push(
      "",
      `--- SOURCE ${i + 1}: ${extraction.file.path} ---`,
      `EXTRACTED RANGES: ${formatLineRanges(extraction.ranges)}`,
      "EXTRACTED MARKDOWN:",
      extraction.extractedContent,
    );
  }
  sections.push(
    "",
    "REQUIRED JSON SCHEMA:",
    JSON.stringify({
      insertions: [{
        after_line: "0 or an active-note line number after which to insert markdown",
        markdown: "markdown to insert; include only new material needed from extracted lines",
        reason: "short reason",
      }],
      notes: "short explanation",
    }, null, 2),
  );

  const prompt = sections.join("\n");
  if (prompt.length > maxMergeInputChars) {
    throw new Error(`Merge input is ${prompt.length} characters, above maxMergeInputChars=${maxMergeInputChars}. Increase the setting or merge fewer notes.`);
  }
  return prompt;
}

export function normalizeSourceLineRanges(input: unknown, content: string, visibleLineLimit: number): MergeLineRange[] {
  if (!Array.isArray(input)) return [];
  const totalLines = splitMarkdownLines(content).length;
  const upperLine = Math.min(totalLines, visibleLineLimit || totalLines);
  const ranges: MergeLineRange[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const startLine = asPositiveInteger(row.startLine ?? row.start_line);
    const endLine = asPositiveInteger(row.endLine ?? row.end_line);
    if (startLine === null || endLine === null) continue;
    if (startLine > endLine || startLine < 1 || endLine > upperLine) continue;
    const reason = typeof row.reason === "string" ? row.reason.trim() : undefined;
    ranges.push({ startLine, endLine, reason });
  }

  return mergeLineRanges(ranges);
}

export function normalizeScopedMergePlan(response: ScopedMergePlanResponse, targetContent: string): ScopedMergePlan {
  const targetLineCount = splitMarkdownLines(targetContent).length;
  const insertions: ScopedMergeInsertion[] = [];
  const rows = Array.isArray(response.insertions) ? response.insertions : [];

  for (const row of rows) {
    const afterLine = asNonNegativeInteger(row.afterLine ?? row.after_line);
    if (afterLine === null || afterLine > targetLineCount) continue;
    const markdown = typeof row.markdown === "string" ? row.markdown.replace(/^\n+|\n+$/g, "") : "";
    if (!markdown.trim()) continue;
    insertions.push({
      afterLine,
      markdown,
      reason: typeof row.reason === "string" ? row.reason.trim() : undefined,
    });
  }

  return {
    insertions,
    notes: typeof response.notes === "string" ? response.notes : undefined,
  };
}

export function applyScopedMergePlan(targetContent: string, plan: ScopedMergePlan): string {
  const lines = splitMarkdownLines(targetContent);
  const ordered = plan.insertions
    .map((insertion, index) => ({ insertion, index }))
    .sort((a, b) => b.insertion.afterLine - a.insertion.afterLine || b.index - a.index);

  for (const { insertion } of ordered) {
    lines.splice(insertion.afterLine, 0, ...splitMarkdownLines(insertion.markdown));
  }

  return lines.join("\n");
}

export function formatScopedMergeAttempt(plan: ScopedMergePlan, finalContent: string): string {
  return [
    "# Scoped Merge Attempt",
    "",
    "## Insertion Plan",
    "",
    "```json",
    JSON.stringify(plan, null, 2),
    "```",
    "",
    "## Final Active Note",
    "",
    finalContent,
  ].join("\n");
}

export function buildSourceExtraction(file: TFile, originalContent: string, ranges: MergeLineRange[]): SourceExtraction {
  const normalized = normalizeSourceLineRanges(
    ranges,
    originalContent,
    splitMarkdownLines(originalContent).length,
  );
  if (!normalized.length) throw new Error(`No valid source line ranges for ${file.path}.`);
  return {
    file,
    originalContent,
    extractedContent: extractLineRanges(originalContent, normalized),
    remainingContent: removeLineRanges(originalContent, normalized),
    ranges: normalized,
  };
}

export function numberedExcerpt(path: string, content: string, maxChars: number): NumberedExcerpt {
  const numbered = numberedNote(path, content);
  if (numbered.length <= maxChars) {
    return { text: numbered, lastLine: splitMarkdownLines(content).length };
  }

  const lines = numbered.split("\n");
  const out: string[] = [];
  let used = 0;
  let lastLine = 0;
  for (const line of lines) {
    const nextLength = used + line.length + (out.length ? 1 : 0);
    if (nextLength > maxChars) break;
    out.push(line);
    used = nextLength;
    const match = line.match(/^\s*(\d+)\s+\|/);
    if (match) lastLine = Number(match[1]);
  }
  out.push(`[truncated after line ${lastLine}]`);
  return { text: out.join("\n"), lastLine };
}

export function numberedNote(path: string, content: string): string {
  const lines = splitMarkdownLines(content);
  return [
    `PATH: ${path}`,
    "LINES:",
    ...lines.map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`),
  ].join("\n");
}

function mergeLineRanges(ranges: MergeLineRange[]): MergeLineRange[] {
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: MergeLineRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
      if (range.reason && previous.reason && !previous.reason.includes(range.reason)) {
        previous.reason = `${previous.reason}; ${range.reason}`;
      } else if (range.reason && !previous.reason) {
        previous.reason = range.reason;
      }
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
