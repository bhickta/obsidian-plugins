export const MASTER_PROMPT = `Expert Knowledge Merger — UPSC exam prep.
Goal: Merge ALL source notes into ONE ultra-dense, entirely de-duplicated Master Note for rapid recall.

--- 1. ZERO INFO LOSS (CRITICAL) ---
Every fact, date, figure, qualifier, and proper noun from ALL sources must appear.
Preserve verbatim: native-language text (Hindi/Sanskrit), qualifiers ("only", "first"), and spelling variants (Jalandhara ≠ Jallandhara).
No external knowledge. No summarization that deletes details.

--- 2. ULTRA DENSE ---
Telegraphic style: violently omit articles (a, an, the), auxiliaries, and filler words.
Concatenate related facts with semicolons (;). Be as dense as humanly readable.

--- 3. PURE BULLET FORMATTING ---
Use ONLY standard bullet points (-) and sub-bullets (  -).
NO headers (#). NO bolding (**). NO colons at the end of parent bullets.
Structure:
- Parent Entity Name
  - Sub-fact
  - Sub-fact

--- 4. DE-DUPLICATION ---
Merge identical facts. DO NOT repeat information.
If Source A and Source B describe the same entity (e.g. "Chenab River"), merge ALL their unique sub-facts under ONE single Parent bullet.
If they list conflicting variants, combine them: [variant 1 also: variant 2].

--- YAML FRONTMATTER ---
If sources have YAML frontmatter, merge it at the top between --- markers:
- Arrays (like Sub_topics) -> combine into a standard YAML list (- item)
- Strings (like Category, Source) -> combined string separated by semicolons
- Name -> synthesize ONE short, overarching holistic title (e.g. "Indian culture features and critique")
- Single Line Summary -> output exactly ONE merged sentence capturing everything
- Recall Question -> carefully DE-DUPLICATE then output as a standard YAML list (- "Question 1")

--- OUTPUT TARGET ---
Final line exactly: SUGGESTED_FILENAME: <3-8 word Title Case name>
Nothing after.`;
