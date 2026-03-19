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

    // ── Provider & API ──
    el.createEl("h3", { text: "AI Provider & API" });
    
    new Setting(el).setName("Provider").setDesc("Select your AI provider.")
      .addDropdown(d => d
        .addOption("gemini", "Google Gemini")
        .addOption("zhipu", "Zhipu AI (GLM)")
        .addOption("openai", "OpenAI")
        .addOption("groq", "Groq")
        .addOption("together", "Together AI")
        .addOption("deepseek", "DeepSeek")
        .addOption("openrouter", "OpenRouter")
        .addOption("custom", "Custom (OpenAI-Compatible)")
        .setValue(this.plugin.settings.provider)
        .onChange(async v => {
           this.plugin.settings.provider = v as any;
           this.plugin.settings.cachedModels = []; // Clear models on switch
           await this.plugin.saveSettings();
           this.display();
        }));

    if (this.plugin.settings.provider === "custom") {
        new Setting(el).setName("Custom Base URL").setDesc("Your OpenAI-compatible endpoint URL.")
          .addText(t => t.setValue(this.plugin.settings.customBaseUrl).onChange(async v => { this.plugin.settings.customBaseUrl = v; await this.plugin.saveSettings(); }));
    }

    const currentProvider = this.plugin.settings.provider;
    new Setting(el)
      .setName(`${currentProvider.toUpperCase()} API Keys`)
      .setDesc("One key per line. Rate-limited keys auto-suspend for 24 h.")
      .addTextArea(t => {
          t.setPlaceholder("sk-...");
          // Fallback legacy logic if exact provider key is empty but we have an old key
          let keys = this.plugin.settings.providerApiKeys[currentProvider];
          if (!keys && currentProvider === "gemini") keys = this.plugin.settings.apiKeys || this.plugin.settings.geminiApiKeys;
          if (!keys) keys = "";
          t.setValue(keys).onChange(async v => {
             this.plugin.settings.providerApiKeys[currentProvider] = v;
             await this.plugin.saveSettings();
          });
      })
      .addButton(btn => btn.setButtonText("Validate").onClick(async () => {
        let raw = this.plugin.settings.providerApiKeys[currentProvider];
        if (!raw && currentProvider === "gemini") raw = this.plugin.settings.apiKeys || this.plugin.settings.geminiApiKeys;
        const keys = (raw || "").split("\n").map(k => k.trim()).filter(k => k.length > 0);
        if (!keys.length) { btn.setButtonText("❌ No keys"); setTimeout(() => btn.setButtonText("Validate"), 2000); return; }
        btn.setButtonText("Testing…"); btn.setDisabled(true);
        try {
          const { executeChatCompletion } = await import("../services/llm");
          let valid = 0;
          for (const key of keys) {
            try { await executeChatCompletion(this.plugin.settings, key, this.plugin.settings.mergerModel, "test", "test"); valid++; }
            catch {}
          }
          btn.setButtonText(valid > 0 ? `✅ ${valid}/${keys.length} valid` : "❌ All invalid");
        } catch { btn.setButtonText("❌ Error"); }
        btn.setDisabled(false); setTimeout(() => btn.setButtonText("Validate"), 3000);
      }));

    // Style the textarea explicitly since Obsidian's styling might not apply to the new one directly
    setTimeout(() => {
        const ta = el.querySelector("textarea");
        if (ta) { ta.style.width = "100%"; ta.rows = 4; ta.style.fontFamily = "var(--font-monospace)"; ta.style.fontSize = "12px"; }
    }, 0);

    // ── Models ──
    el.createEl("h3", { text: "Models" });

    new Setting(el).setName("Refresh available models").setDesc("Fetch the latest list of models from your provider.")
      .addButton(btn => btn.setButtonText("Refresh").onClick(async () => {
        let raw = this.plugin.settings.providerApiKeys[currentProvider];
        if (!raw && currentProvider === "gemini") raw = this.plugin.settings.apiKeys || this.plugin.settings.geminiApiKeys;
        const keys = (raw || "").split("\n").map(k => k.trim()).filter(k => k.length > 0);
        if (!keys.length) { btn.setButtonText("❌ No keys"); setTimeout(() => btn.setButtonText("Refresh"), 2000); return; }
        btn.setButtonText("Fetching..."); btn.setDisabled(true);
        try {
          let models: string[] = [];
          if (this.plugin.settings.provider === "gemini") {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keys[0]}`);
            if (r.ok) {
              const data = await r.json();
              models = data.models.filter((m: any) => m.supportedGenerationMethods?.includes("generateContent")).map((m: any) => m.name.replace("models/", ""));
            }
          } else {
            // OpenAI Compatible GET /models
            let baseUrl = this.plugin.settings.customBaseUrl;
            if (this.plugin.settings.provider === "zhipu") baseUrl = "https://open.bigmodel.cn/api/paas/v4";
            else if (this.plugin.settings.provider === "openai") baseUrl = "https://api.openai.com/v1";
            else if (this.plugin.settings.provider === "groq") baseUrl = "https://api.groq.com/openai/v1";
            else if (this.plugin.settings.provider === "together") baseUrl = "https://api.together.xyz/v1";
            else if (this.plugin.settings.provider === "deepseek") baseUrl = "https://api.deepseek.com";
            else if (this.plugin.settings.provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1";
            
            const url = baseUrl.endsWith("/") ? baseUrl + "models" : baseUrl + "/models";
            const r = await fetch(url, { headers: { "Authorization": `Bearer ${keys[0]}` } });
            if (r.ok) {
                const data = await r.json();
                if (data.data) models = data.data.map((m: any) => m.id);
            }
          }

          if (models.length > 0) {
            this.plugin.settings.cachedModels = models;
            await this.plugin.saveSettings();
            this.display(); // Refresh UI
            return;
          }
          btn.setButtonText("❌ Failed");
        } catch { btn.setButtonText("❌ Error"); }
        setTimeout(() => { btn.setButtonText("Refresh"); btn.setDisabled(false); }, 2000);
      }));

    this.modelDropdown(el, "Merger model", "Does the merging.", "mergerModel");
    this.modelDropdown(el, "Judge model", "Audits output. Disable judge below to skip.", "judgeModel");

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

  private modelDropdown(el: HTMLElement, name: string, desc: string, key: "mergerModel" | "judgeModel") {
    new Setting(el).setName(name).setDesc(desc)
      .addDropdown(d => {
        const val = this.plugin.settings[key];
        const models = this.plugin.settings.cachedModels.length > 0 ? this.plugin.settings.cachedModels : [];
        if (val && !models.includes(val)) models.unshift(val); // always include current selection
        models.forEach(m => d.addOption(m, m));
        d.setValue(val).onChange(async v => { this.plugin.settings[key] = v; await this.plugin.saveSettings(); });
      });
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
