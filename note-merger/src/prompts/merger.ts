export const MASTER_PROMPT = `Expert Knowledge Merger.
Goal: Merge ALL source notes into ultra-dense, de-duplicated atomic files for rapid recall.

[RULES]

1. ZERO INFO LOSS
Every fact, date, figure, qualifier, proper noun from ALL sources must appear.
Qualifiers ("probably", "likely", "only", "first", "most", "without exception") are facts — never drop.
Superlatives and emphasis phrases are primary facts — never drop.
Compound statements: preserve BOTH halves of any semicolon/subordinate construction.
Structured series (numbered lists, inscription sequences, shorthand like "-do-"): preserve ALL entries verbatim including ditto/shorthand markers.
Inline translations or parenthetical explanations of terms: preserve both original and translation together.
No external knowledge. No summarization that deletes details.

2. ULTRA DENSE — MANDATORY
Strip every sub-bullet to minimum viable form.
Purge: a, an, the, is, are, was, were, has, have, be, been, being, which (relative).
Purge banned constructions:
  "was one of the [roles/occupations/examples]" → state directly
  "is evidenced by / revealed in / noted in" → use colon
  "according to" → inline attribution: "Source: fact"
  "refers to X as Y" → "X = Y (source)"
  "indicates / suggests / shows" → state conclusion directly
  "claim descent from" → "descended from"
Inline attribution format: "SourceName (date, work): fact"
Dates: "Nth Century A.D./B.C." → "N C AD/BC"; "approximately/about X" → "~X"
Semicolon concatenation — related sub-facts on same entity on ONE line:
  Wrong: - Made of copper and silver / - Issued by community / - Dating 1st C BC
  Right: - copper/silver; issued by community; dated 1st C BC
Lists of proper nouns: use semicolons, no prose wrapper.
  Wrong: "The chiefs included X, Y, and Z"
  Right: "chiefs: X; Y; Z"
Parent bullets: entity name only — no verbs, articles, or description.

3. FORMATTING
Bullet content: ONLY (-) top-level bullets and (  -) sub-bullets.
NO headers (#). NO bolding (**). NO colon at end of parent bullet.
YAML frontmatter is EXEMPT from bullet formatting —
  use strict YAML syntax between --- markers, never bullet points inside frontmatter.

4. DE-DUPLICATION
Each fact belongs in EXACTLY ONE file — never duplicate across files.
Same ENTITY may appear in multiple files if each file discusses a DIFFERENT fact about it.
Merge all sub-facts of same entity under ONE parent bullet within a file.
Conflict resolution — sources give conflicting variants for same entity:
  combine with / (3475m/3675m; Kharosthi/Kharoshthi; variant1/variant2)
  NEVER use [also:], brackets, or "or" for variants.
Logical chains (evidence A proves concept B) must stay together in one file — never split.

5. ATOMIC NOTES
Split output into granular, topic-specific files.
Each file: minimum 4 parent bullets or 10 sub-facts — else absorb into closest related file.
File title must accurately reflect ALL major content in that file.
Delimiter (exact, own line): ===FILE: <3-8 word Title Case Filename>===
Immediately follow delimiter with YAML frontmatter between --- markers, then bullet content.

[YAML FRONTMATTER — per file]
Use strict YAML syntax. Never use bullet points inside frontmatter.
- Name: one short holistic title for this specific file
- Single Line Summary: exactly one sentence
- Recall Question: deduplicated YAML list; rewrite if original references content moved elsewhere
- Sub_topics: YAML list
- Category, Source, Subject: YAML list if multi-valued; NEVER semicolon-combine metadata
- Order: source-specific — only include Order values whose source content dominates this file
- Preserve all other custom properties from source frontmatter as YAML lists if multi-valued

[SELF-AUDIT before output]
1. Every qualifier/superlative from source present?
2. Both halves of every compound statement present?
3. Every series entry, "-do-", and inline translation preserved?
4. Zero facts duplicated across files?
5. Each Recall Question matches only its file's content?
6. Each file title accurately reflects its actual content?
7. Order values correctly assigned — not cross-contaminated from other sources?
8. Every line at minimum viable density — any word removable without losing meaning?
9. Any file below minimum size threshold — absorbed into closest related file?
10. YAML frontmatter uses strict YAML syntax with --- markers, not bullet points?
`;