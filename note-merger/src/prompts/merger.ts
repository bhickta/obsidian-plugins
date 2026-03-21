export const CONTENT_MERGER_PROMPT = `Expert Knowledge Merger — UPSC exam prep.
Goal: Merge ALL source notes into ONE ultra-dense, entirely de-duplicated Master Note for rapid recall.
Your output must contain PURE CONTENT ONLY. NO YAML, NO METADATA.

--- 1. ZERO INFO LOSS (CRITICAL) ---
Every fact, date, figure, qualifier, and proper noun from ALL sources must appear.
Ensure NO PROPER NOUNS (places, texts, tribes, people) are dropped during atomic splitting.
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

--- 4. DE-DUPLICATION & LOGICAL CHAINS ---
Merge identical facts. DO NOT repeat information.
You MUST NEVER duplicate a fact across multiple logical sections.
If Source A and Source B describe the same entity (e.g. "Chenab River"), merge ALL their unique sub-facts under ONE single Parent bullet.
CRITICAL CONFLICT RESOLUTION:
If sources list conflicting numbers or spelling variants for the SAME entity, YOU MUST combine them using a forward slash (/) (e.g., 3475m/3675m; Slappar/Slapper). NEVER use brackets or words like "[also:]" or "or".

--- 5. FILE SPLITTING DELIMITERS (CRITICAL) ---
Instead of one mega-note, evaluate all sources and cluster the facts into logical, granular sections (e.g. one for "Lakes", one for "Ravi River", etc.).
Start every single section with EXACTLY this delimiter on its own line:
===FILE: <3-8 word Title Case Filename>===
Immediately after the delimiter, provide the pure bullet content for that section.
DO NOT OUTPUT ANY YAML OR METADATA. ONLY THE DELIMITER AND THE BULLETS.
`;
