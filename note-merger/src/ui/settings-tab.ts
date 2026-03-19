import { App, PluginSettingTab, Setting } from "obsidian";
import type NoteMergerPlugin from "../main";
import { MASTER_PROMPT, DEFAULT_JUDGE_PROMPT } from "../prompts";

export class NoteMergerSettingTab extends PluginSettingTab {
  plugin: NoteMergerPlugin;
  constructor(app: App, plugin: NoteMergerPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl: el } = this;
    el.empty();
    el.createEl("h2", { text: "Note Merger" });

    // ── API ──
    el.createEl("h3", { text: "API" });
    new Setting(el)
      .setName("Gemini API keys")
      .setDesc("One key per line. Rate-limited keys auto-suspend for 24 h.")
      .addTextArea(t => t.setPlaceholder("AIzaSy...\nAIzaSy...")
        .setValue(this.plugin.settings.geminiApiKeys)
        .onChange(async v => { this.plugin.settings.geminiApiKeys = v; await this.plugin.saveSettings(); }))
      .addButton(btn => btn.setButtonText("Validate").onClick(async () => {
        const keys = this.plugin.settings.geminiApiKeys.split("\n").map(k => k.trim()).filter(k => k.length > 0);
        if (!keys.length) { btn.setButtonText("❌ No keys"); setTimeout(() => btn.setButtonText("Validate"), 2000); return; }
        btn.setButtonText("Testing…"); btn.setDisabled(true);
        try {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          let valid = 0;
          for (const key of keys) {
              try { await new GoogleGenerativeAI(key).getGenerativeModel({ model: "gemini-2.0-flash-lite" }).generateContent("S"); valid++; }
              catch {} 
              if (keys.length > 1) await new Promise(r => setTimeout(r, 1000));
            }
          btn.setButtonText(valid > 0 ? `✅ ${valid}/${keys.length} valid` : "❌ All invalid");
        } catch { btn.setButtonText("❌ Error"); }
        btn.setDisabled(false); setTimeout(() => btn.setButtonText("Validate"), 3000);
      }));
    const ta = el.querySelector("textarea");
    if (ta) { ta.style.width = "100%"; (ta as HTMLTextAreaElement).rows = 4; ta.style.fontFamily = "var(--font-monospace)"; ta.style.fontSize = "12px"; }

    // ── Models ──
    el.createEl("h3", { text: "Models" });
    this.textSetting(el, "Merger model", "Does the merging.", "mergerModel");
    this.textSetting(el, "Judge model", "Audits output. Disable judge below to skip.", "judgeModel");

    // ── Quality ──
    el.createEl("h3", { text: "Quality control" });
    new Setting(el).setName("Enable judge").setDesc("Run judge model after every merge.")
      .addToggle(t => t.setValue(this.plugin.settings.enableJudge).onChange(async v => { this.plugin.settings.enableJudge = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Auto-approve threshold").setDesc("Score above which merge auto-passes.")
      .addSlider(s => s.setLimits(0.5, 1.0, 0.01).setValue(this.plugin.settings.autoApproveThreshold).setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.autoApproveThreshold = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Max retries").setDesc("1 = no retries.")
      .addSlider(s => s.setLimits(1, 5, 1).setValue(this.plugin.settings.maxRetries).setDynamicTooltip()
        .onChange(async v => { this.plugin.settings.maxRetries = v; await this.plugin.saveSettings(); }));

    // ── Behaviour ──
    el.createEl("h3", { text: "Behaviour" });
    new Setting(el).setName("Auto-rename after merge").setDesc("Suggest AI-generated filename.")
      .addToggle(t => t.setValue(this.plugin.settings.enableAutoRename).onChange(async v => { this.plugin.settings.enableAutoRename = v; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Delete source notes").setDesc("⚠️ Permanently deletes originals after approval.")
      .addToggle(t => t.setValue(this.plugin.settings.deleteSourceAfterMerge).onChange(async v => { this.plugin.settings.deleteSourceAfterMerge = v; await this.plugin.saveSettings(); }));
    this.textSetting(el, "Training data path", "Vault-relative JSONL path.", "trainingDataPath");

    // ── Prompts ──
    el.createEl("h3", { text: "System prompts" });
    this.promptEditor(el, "Merger prompt", "mergerPrompt", MASTER_PROMPT);
    this.promptEditor(el, "Judge prompt", "judgePrompt", DEFAULT_JUDGE_PROMPT);
  }

  private textSetting(el: HTMLElement, name: string, desc: string, key: keyof typeof this.plugin.settings) {
    new Setting(el).setName(name).setDesc(desc)
      .addText(t => t.setValue(String(this.plugin.settings[key])).onChange(async v => { (this.plugin.settings as any)[key] = v.trim(); await this.plugin.saveSettings(); }));
  }

  private promptEditor(el: HTMLElement, name: string, key: "mergerPrompt" | "judgePrompt", def: string) {
    new Setting(el).setName(name).addTextArea(t => {
      t.setValue(this.plugin.settings[key]).onChange(async v => { this.plugin.settings[key] = v; await this.plugin.saveSettings(); });
      t.inputEl.rows = 14; t.inputEl.style.width = "100%"; t.inputEl.style.fontFamily = "var(--font-monospace)"; t.inputEl.style.fontSize = "11px";
    });
    const btn = el.createEl("button", { text: "Reset to default" }); btn.style.marginBottom = "20px";
    btn.onclick = async () => { this.plugin.settings[key] = def; await this.plugin.saveSettings(); this.display(); };
  }
}
