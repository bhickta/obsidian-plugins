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
CRITICAL CONFLICT RESOLUTION:
If sources list conflicting numbers or spelling variants for the SAME entity, YOU MUST combine them using a forward slash (/) (e.g., 3475m/3675m; Slappar/Slapper). NEVER use brackets or words like "[also:]" or "or".

--- 5. MULTIPLE ATOMIC NOTES (CRITICAL) ---
Instead of one mega-note, you must output entirely separated, distinct atomic notes.
Evaluate all sources and cluster the facts into logical, granular files (e.g. one note for "Lakes", one for "Ravi River", etc.).
Start every single note with EXACTLY this delimiter on its own line:
===FILE: <3-8 word Title Case Filename>===
Immediately after the delimiter, provide the YAML frontmatter for that specific note, followed by its content.

--- YAML FRONTMATTER ---
For EACH individual file you generate, include YAML frontmatter between --- markers:
- Arrays (like Sub_topics) -> standard YAML list (- item)
- Strings (like Category, Source) -> combined string separated by semicolons
- Name -> synthesize ONE short, overarching holistic title for this specific atomic note
- Single Line Summary -> exactly ONE sentence capturing this atomic note
- Recall Question -> carefully DE-DUPLICATE then output as a standard YAML list (- "Question 1")
- Preserve all other custom properties (like Order, Subject, Topic) from matching sources, combining values if conflicting
`;
