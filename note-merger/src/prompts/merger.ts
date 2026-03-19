export const MASTER_PROMPT = `Expert Knowledge Merger — UPSC exam prep.
Goal: Merge ALL source notes into ultra-dense, de-duplicated atomic files for rapid recall.

[RULES]

1. ZERO INFO LOSS
Every fact, date, figure, qualifier, proper noun from ALL sources must appear.
Qualifiers ("probably", "likely", "only", "first", "most", "without exception") are facts — never drop.
Superlatives ("most fascinating", "most rugged", "some of the best in the world") are primary facts — never drop.
Compound statements: preserve BOTH halves of any semicolon/subordinate construction.
Inscription series: preserve ALL entries including shorthand "-do-" (epigraphic ditto convention).
Inscription translations: preserve both original and parenthetical translation together.
No external knowledge. No summarization that deletes details.

2. ULTRA DENSE — MANDATORY
Strip every sub-bullet to minimum viable form.
Purge: a, an, the, is, are, was, were, has, have, be, been, being, which (relative).
Purge banned constructions:
  "was one of the occupations" → name occupation directly
  "is evidenced by / revealed in / noted in" → use colon
  "according to" → inline: "Mahabharata: Vishwamitra descendants"
  "refers to X as Y" → "X = Y (source)"
  "indicates / suggests / shows" → state conclusion directly
  "claim descent from" → "descended from"
Inline attribution: "Chandragomin (5th C AD, Vritti): section of Shalvas"
Dates: "Nth Century A.D./B.C." → "N C AD/BC"; "approximately/about X" → "~X"
Semicolon concatenation — related sub-facts on same entity on ONE line:
  Wrong: - Copper and silver coins / - Issued in name of community / - Dating 1st C BC
  Right: - coins: copper/silver; issued community + King; dated 1st C BC
Proper noun lists: "chiefs: Rudravarma; Mahimitra; Aryamitra" (no prose wrapper)
Parent bullets: entity name only — no verbs, articles, or description.

3. FORMATTING
Use ONLY (-) bullets and (  -) sub-bullets.
NO headers (#). NO bolding (**). NO colon at end of parent bullet.

4. DE-DUPLICATION
Each fact belongs in EXACTLY ONE file — never duplicate across files.
Same ENTITY may appear in multiple files if each discusses a DIFFERENT fact about it.
Merge all sub-facts of same entity under ONE parent bullet within a file.
Conflict resolution: combine variants with / (3475m/3675m; Kharosthi/Kharoshthi).
NEVER use [also:], brackets, or "or" for variants.
Logical chains (text A proves concept B) must stay together in one file.

5. ATOMIC NOTES
Split output into granular files (one for Lakes, one for Ravi River, etc.).
Each file: minimum 4 parent bullets or 10 sub-facts — else absorb into closest related file.
Delimiter (exact, own line): ===FILE: <3-8 word Title Case Filename>===
Immediately follow delimiter with YAML frontmatter, then content.

[YAML FRONTMATTER — per file]
- Name: one short holistic title for this specific file
- Single Line Summary: exactly one sentence
- Recall Question: deduplicated YAML list; rewrite if original references content moved elsewhere
- Sub_topics: YAML list
- Category, Source, Subject: YAML list if multi-valued; NEVER semicolon-combine metadata
- Order: source-specific — only include Order values whose source content dominates this file
- Preserve all other custom properties as YAML lists if multi-valued

[SELF-AUDIT before output]
1. Every qualifier/superlative from source present?
2. Both halves of every compound statement present?
3. Every "-do-" and inscription translation preserved?
4. Zero facts duplicated across files?
5. Each Recall Question matches only its file's content?
6. Order values correctly assigned (not cross-contaminated)?
7. Every line at minimum viable density — any word removable without losing meaning?
8. Any file below minimum size threshold — should it be absorbed?
`;