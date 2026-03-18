import { App, PluginSettingTab, Setting } from "obsidian";
import NoteMergerPlugin from "./main";

// ─────────────────────────────────────────────────────────────
// SINGLE MASTER PROMPT
// Replaces both DEFAULT_MERGER_PROMPT and ULTRA_DENSE_PROMPT.
// ─────────────────────────────────────────────────────────────
export const MASTER_PROMPT = `You are an Expert Knowledge Merger for UPSC civil services exam prep.
Merge ALL provided source notes into one ultra-dense Master Note optimised for rapid recall.

━━━ ZERO LOSS (HIGHEST PRIORITY) ━━━
Every fact, date, figure, statistic, qualifier, proper noun, and example from ALL sources must appear in output.
NEVER drop or paraphrase:
- Native-language text (Sanskrit verses, Hindi/Urdu terms, Devanagari script) — copy byte-for-byte.
- Specific qualifiers: "entirely", "only", "first", "largest", "Sanskrit scholar", "as per X".
- Spelling variants of proper nouns — NOT typos. Jalandhara and Jallandhara are distinct; preserve both everywhere.
- Named attributions: if a source credits a scholar, author, or institution, that credit must survive.
No external knowledge. No inference. No gap-filling.

━━━ DEDUPLICATION ━━━
Merge a bullet only when wording AND meaning are byte-for-byte identical. When in doubt, keep both.
- Same entity, different facts → single header, all sub-facts preserved underneath.
- Different entities, similar names → separate entries, disambiguating note in parentheses after each.
- Near-identical facts with minor wording differences → keep more specific version, append variant in brackets: [also: variant].
- Two sources make different but non-contradictory claims about same entity → preserve BOTH joined by semicolon. Never use "or" to suggest they are alternatives.

━━━ FORMAT ━━━
Telegraphic style: omit articles (a/an/the), auxiliary verbs (is/are/was/were), conjunctions — unless omitting creates ambiguity.

OUTPUT STRUCTURE — two modes, choose per bullet:

Mode 1 — Standalone fact (no grouping needed):
- **Term**: details on same line.

Mode 2 — Grouped category (2+ related facts share a clear conceptual umbrella):
- Parent concept name (plain text, Title Case, no bold, no colon)
\t- **Child Term**: details on same line.
\t- **Child Term**: details on same line.

GROUPING RULES:
- You MUST group when 3 or more bullets share a clear conceptual umbrella.
  Leaving related facts flat when a natural parent exists is a formatting failure.
- Natural parents to always look for:
    - A named entity with multiple facts (geography + etymology + mythology = one parent)
    - A named text or source with multiple claims (Padma Purana birth + body = one parent)
    - A named place with multiple sub-facts
- Group bullets under a parent ONLY when they share a clear conceptual umbrella.
- Parent label: plain text, Title Case, no bold, no colon.
- All actual facts live at child level with bold term + details.
- Standalone facts with no natural group stay at top level as Mode 1.
- Maximum 2 levels. Never nest a group inside a group.

━━━ YAML FRONTMATTER ━━━
If ANY input has YAML frontmatter (between --- markers), output merged frontmatter first inside --- markers.
General rule: preserve EVERY field present in ANY source. Never drop a field.
- Fields present in all sources → merge values.
- Fields present in only one source → carry forward as-is.
- Array fields → strict union of all values, no duplicates. MUST remain YAML list using - notation. Never convert to comma or semicolon string.
- String fields in multiple sources → combine with semicolons.
- Conflicting scalar values → keep both separated by " | ".
- Sub_topics MUST use underscore (not hyphen) and MUST be a YAML list, never a string.
Three fields require synthesis:
  - Name: one holistic title covering all source topics.
  - Single Line Summary: one sentence covering full merged scope.
  - Recall Question: YAML literal block scalar, original wording from each source:
    >
      (1) [exact wording from source 1]
      (2) [exact wording from source 2]

CRITICAL YAML CHECK — before outputting frontmatter, verify:
- Does Sources contain ALL source files as a YAML list? 
- Does Sub_topics contain sub-topics from EVERY source as a YAML list?
- Does Recall Question have one numbered entry per source with original wording?
If any check fails, your frontmatter is wrong — fix it before outputting.

━━━ OUTPUT TERMINATION ━━━
Final line must be exactly:
SUGGESTED_FILENAME: <3-8 word Title Case name reflecting ALL sources, not just source 1>
Nothing after this line — no newline, no period, no explanation.`;

// ─────────────────────────────────────────────────────────────
// JUDGE PROMPT
// ─────────────────────────────────────────────────────────────
export const DEFAULT_JUDGE_PROMPT = `You are a strict quality judge for merged UPSC study notes.
Evaluate whether the merged output preserves ALL information from ALL source inputs.

Before scoring, explicitly verify:
1. Every **Bold Term** from source inputs — present in merged output?
2. Every YAML field from source inputs — present and correctly formatted?
3. Sub_topics — proper YAML list using - notation, field name has underscore not hyphen?
4. Recall Question — numbered literal block scalar with one entry per source, original wording preserved?
5. All spelling variants of proper nouns preserved (e.g. both Jalandhara and Jallandhara)?
6. All qualifiers preserved ("entirely", "Sanskrit scholar", "first", "only")?
7. All native-language text (Sanskrit, Hindi, Devanagari) copied verbatim?

Return ONLY a valid JSON object — no markdown fences, no explanation, nothing else:
{
  "score": <float 0.0 to 1.0>,
  "missing_facts": [<string>, ...],
  "missing_yaml_fields": [<string>, ...],
  "yaml_format_issues": [<string>, ...],
  "pronoun_issues": [<string>, ...],
  "structure_issues": [<string>, ...],
  "verdict": "PASS" | "FAIL"
}

Scoring rules — start at 1.0 and deduct:
- 0.15 per missing named entity or bold term
- 0.10 per missing specific fact (date, figure, location, statistic)
- 0.10 per missing or dropped YAML field
- 0.08 per YAML format error (wrong field name, list converted to string, Recall Question not a numbered block)
- 0.05 per dropped qualifier ("entirely", "Sanskrit scholar", etc.)
- 0.05 per unresolved pronoun
- 0.05 per structural nesting error
verdict is "PASS" if score >= 0.92, otherwise "FAIL".`;

// ─────────────────────────────────────────────────────────────
// SETTINGS INTERFACE
// ─────────────────────────────────────────────────────────────
export interface PluginSettings {
  geminiApiKey: string;
  geminiApiKeys: string;
  failedKeys: Record<string, number>;
  mergerModel: string;
  judgeModel: string;
  autoApproveThreshold: number;
  enableJudge: boolean;
  trainingDataPath: string;
  deleteSourceAfterMerge: boolean;
  maxRetries: number;
  enableAutoRename: boolean;
  mergerPrompt: string;
  judgePrompt: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  geminiApiKey: "",
  geminiApiKeys: "",
  failedKeys: {},
  mergerModel: "gemini-3.1-pro-preview",
  judgeModel: "gemini-2.5-flash-latest",
  autoApproveThreshold: 0.92,
  enableJudge: false,
  trainingDataPath: "_training/dataset.jsonl",
  deleteSourceAfterMerge: false,
  maxRetries: 3,
  enableAutoRename: true,
  mergerPrompt: MASTER_PROMPT,
  judgePrompt: DEFAULT_JUDGE_PROMPT,
};

// ─────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────
export class NoteMergerSettingTab extends PluginSettingTab {
  plugin: NoteMergerPlugin;

  constructor(app: App, plugin: NoteMergerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Note Merger" });

    // ── API ───────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "API" });

    new Setting(containerEl)
      .setName("Gemini API keys")
      .setDesc(
        "One key per line. If a key hits a rate limit it is auto-suspended for 24 h and the next key is used."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("AIzaSy...\nAIzaSy...")
          .setValue(this.plugin.settings.geminiApiKeys)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKeys = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Validate").onClick(async () => {
          const keys = this.plugin.settings.geminiApiKeys
            .split("\n")
            .map((k) => k.trim())
            .filter((k) => k.length > 0);
          if (keys.length === 0) {
            btn.setButtonText("❌ No keys");
            setTimeout(() => btn.setButtonText("Validate"), 2000);
            return;
          }
          btn.setButtonText("Testing…");
          btn.setDisabled(true);
          try {
            const { GoogleGenerativeAI } = await import("@google/generative-ai");
            let valid = 0;
            for (const key of keys) {
              try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({
                  model: "gemini-2.5-flash-lite-latest",
                });
                await model.generateContent("S");
                valid++;
              } catch {
                // key failed — try next
              }
            }
            btn.setButtonText(
              valid > 0 ? `✅ ${valid}/${keys.length} valid` : "❌ All invalid"
            );
          } catch {
            btn.setButtonText("❌ Error");
          }
          btn.setDisabled(false);
          setTimeout(() => btn.setButtonText("Validate"), 3000);
        })
      );

    const apiTextArea = containerEl.querySelector("textarea");
    if (apiTextArea) {
      apiTextArea.style.width = "100%";
      (apiTextArea as HTMLTextAreaElement).rows = 4;
      apiTextArea.style.fontFamily = "var(--font-monospace)";
      apiTextArea.style.fontSize = "12px";
    }

    // ── Models ────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Models" });

    new Setting(containerEl)
      .setName("Merger model")
      .setDesc("Does the actual merging. A cheaper/faster model works well here.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.mergerModel)
          .onChange(async (value) => {
            this.plugin.settings.mergerModel = value.trim();
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Judge model")
      .setDesc("Audits the merge output. A stronger model is recommended. Disable judge below to skip.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.judgeModel)
          .onChange(async (value) => {
            this.plugin.settings.judgeModel = value.trim();
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (
      this.plugin.settings.mergerModel.trim() ===
      this.plugin.settings.judgeModel.trim()
    ) {
      const warn = containerEl.createEl("p", {
        text: "⚠️ Merger and Judge are the same model. The judge cannot reliably audit its own output — change one of them.",
      });
      warn.style.color = "var(--text-error)";
      warn.style.fontSize = "13px";
      warn.style.marginTop = "4px";
    }

    // ── Quality control ───────────────────────────────────────
    containerEl.createEl("h3", { text: "Quality control" });

    new Setting(containerEl)
      .setName("Enable judge")
      .setDesc(
        "Run the judge model after every merge. Disabling saves tokens but removes quality gating."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableJudge)
          .onChange(async (value) => {
            this.plugin.settings.enableJudge = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-approve threshold")
      .setDesc(
        "Judge score at or above this value auto-approves. Below it goes to review queue. Recommended: 0.92."
      )
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 1.0, 0.01)
          .setValue(this.plugin.settings.autoApproveThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.autoApproveThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max retries on failure")
      .setDesc(
        "Auto-retry the merge if the judge score is below threshold. 1 = no retries."
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.maxRetries)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxRetries = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Behaviour ─────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Behaviour" });

    new Setting(containerEl)
      .setName("Auto-rename after merge")
      .setDesc(
        "Suggest the AI-generated filename from SUGGESTED_FILENAME after approving."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoRename)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoRename = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Delete source notes after merge")
      .setDesc(
        "⚠️ Permanently deletes original files after you approve. Cannot be undone."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteSourceAfterMerge)
          .onChange(async (value) => {
            this.plugin.settings.deleteSourceAfterMerge = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Training data path")
      .setDesc("Vault-relative path for the JSONL dataset of approved merges.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.trainingDataPath)
          .onChange(async (value) => {
            this.plugin.settings.trainingDataPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ── System prompts ────────────────────────────────────────
    containerEl.createEl("h3", { text: "System prompts" });

    new Setting(containerEl)
      .setName("Merger prompt")
      .setDesc(
        "System instruction for the merger model. Must contain the SUGGESTED_FILENAME line."
      )
      .addTextArea((text) => {
        text
          .setValue(this.plugin.settings.mergerPrompt)
          .onChange(async (value) => {
            this.plugin.settings.mergerPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 16;
        text.inputEl.style.width = "100%";
        text.inputEl.style.fontFamily = "var(--font-monospace)";
        text.inputEl.style.fontSize = "11px";
      });

    const mergerReset = containerEl.createEl("button", {
      text: "Reset to default",
    });
    mergerReset.style.marginBottom = "20px";
    mergerReset.onclick = async () => {
      this.plugin.settings.mergerPrompt = MASTER_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    };

    new Setting(containerEl)
      .setName("Judge prompt")
      .setDesc(
        "System instruction for the judge model. Must instruct it to return only a JSON object."
      )
      .addTextArea((text) => {
        text
          .setValue(this.plugin.settings.judgePrompt)
          .onChange(async (value) => {
            this.plugin.settings.judgePrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 14;
        text.inputEl.style.width = "100%";
        text.inputEl.style.fontFamily = "var(--font-monospace)";
        text.inputEl.style.fontSize = "11px";
      });

    const judgeReset = containerEl.createEl("button", {
      text: "Reset to default",
    });
    judgeReset.onclick = async () => {
      this.plugin.settings.judgePrompt = DEFAULT_JUDGE_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    };
  }
}