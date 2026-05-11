import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import ZettelMergeAIPlugin from "./main";
import { DEFAULT_MERGE_PROMPT, ZettelMergeSettings } from "./types";
import { OpenAICompatibleClient, OpenAIModelInfo } from "./openai-client";

export class ZettelMergeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ZettelMergeAIPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Zettel Merge AI" });

    containerEl.createEl("h3", { text: "Scope" });
    this.textSetting("Zettelkasten folder", "Only markdown files under this folder are considered.", "rootFolder");
    this.textSetting("Data folder", "Archive, embedding index, and training dataset folder.", "dataFolder");

    containerEl.createEl("h3", { text: "OpenAI-compatible server" });
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Example: http://127.0.0.1:1234/v1 for LM Studio / lms-server.")
      .addText(text => text.setValue(this.plugin.settings.baseUrl).onChange(async value => {
        this.plugin.settings.baseUrl = value.trim();
        this.clearModelCache();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("API key")
      .setDesc("Optional for local servers. Sent as Bearer token only when non-empty.")
      .addText(text => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.apiKey).onChange(async value => {
          this.plugin.settings.apiKey = value.trim();
          this.clearModelCache();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Refresh available models")
      .setDesc("Calls GET /models on the configured base URL and updates the model dropdowns.")
      .addButton(button => button.setButtonText("Refresh").onClick(async () => this.refreshModels(button)));
    this.modelSetting(
      "Chat model",
      "Used for merge decisions, merge generation, and validation.",
      "chatModel",
      () => this.plugin.settings.cachedChatModels,
    );
    this.modelSetting(
      "Embedding model",
      "Used for candidate search. Choose the embedding model exposed by your local server.",
      "embeddingModel",
      () => this.plugin.settings.cachedEmbeddingModels,
    );
    const refreshed = this.plugin.settings.modelsRefreshedAt
      ? new Date(this.plugin.settings.modelsRefreshedAt).toLocaleString()
      : "never";
    containerEl.createDiv({
      text: `Model list refreshed: ${refreshed}`,
      cls: "setting-item-description",
    });

    containerEl.createEl("h3", { text: "Automation" });
    this.toggleSetting("Auto-suggest on note open", "When opening a scoped note, find merge candidates and show the review modal.", "autoSuggestOnOpen");
    this.toggleSetting("Enable auto-merge command", "Allows the auto-merge command to apply high-confidence candidates without the review modal.", "autoMergeEnabled");
    this.toggleSetting("Delete source notes after successful merge", "Sources are deleted from the visible vault only after archive, quality, rollback, and training files are written.", "deleteSourcesAfterMerge");

    containerEl.createEl("h3", { text: "Thresholds" });
    this.numberSetting("Candidate limit", "Number of embedding matches sent to the mergeability judge.", "candidateLimit", 1, 50);
    this.numberSetting("Max files to scan", "Caps first-pass embedding scan size for large vaults.", "maxFilesToScan", 10, 5000);
    this.numberSetting("Review threshold", "Candidates below this merge confidence are hidden.", "reviewThreshold", 0, 1, 0.01);
    this.numberSetting("Auto-merge threshold", "Auto command only merges candidates at or above this confidence.", "autoMergeThreshold", 0, 1, 0.01);
    this.numberSetting("Validation threshold", "Merge applies only when coverage and judge score meet this value.", "validationThreshold", 0, 1, 0.01);
    this.numberSetting("Max merge retries", "Retries when validation finds missing information.", "maxMergeRetries", 1, 5);

    containerEl.createEl("h3", { text: "Prompt limits" });
    this.numberSetting("Embedding source chars", "Chars from each note used for embeddings.", "embeddingSourceChars", 500, 20000);
    this.numberSetting("Candidate judge chars", "Chars per note sent to the mergeability judge.", "candidateJudgeChars", 500, 10000);
    this.numberSetting("Max merge input chars", "Hard stop before merge if source text exceeds this size.", "maxMergeInputChars", 5000, 500000);

    containerEl.createEl("h3", { text: "Merge prompt" });
    new Setting(containerEl)
      .setName("System prompt")
      .addTextArea(text => {
        text.setValue(this.plugin.settings.mergeSystemPrompt).onChange(async value => {
          this.plugin.settings.mergeSystemPrompt = value;
          await this.plugin.saveSettings();
        });
        text.inputEl.rows = 14;
        text.inputEl.style.width = "100%";
        text.inputEl.style.fontFamily = "var(--font-monospace)";
        text.inputEl.style.fontSize = "11px";
      });
    const reset = containerEl.createEl("button", { text: "Reset merge prompt" });
    reset.onclick = async () => {
      this.plugin.settings.mergeSystemPrompt = DEFAULT_MERGE_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    };
  }

  private textSetting(name: string, desc: string, key: keyof ZettelMergeSettings): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText(text => text.setValue(String(this.plugin.settings[key])).onChange(async value => {
        (this.plugin.settings as any)[key] = value.trim();
        await this.plugin.saveSettings();
      }));
  }

  private modelSetting(
    name: string,
    desc: string,
    key: "chatModel" | "embeddingModel",
    getModels: () => string[],
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addDropdown(dropdown => {
        const current = this.plugin.settings[key];
        const models = this.withCurrentModel(getModels(), current);
        for (const model of models) dropdown.addOption(model, model);
        dropdown.setValue(current);
        dropdown.onChange(async value => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
        });
      })
      .addText(text => text
        .setPlaceholder("Manual model id")
        .setValue(this.plugin.settings[key])
        .onChange(async value => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  private toggleSetting(name: string, desc: string, key: keyof ZettelMergeSettings): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle(toggle => toggle.setValue(Boolean(this.plugin.settings[key])).onChange(async value => {
        (this.plugin.settings as any)[key] = value;
        await this.plugin.saveSettings();
      }));
  }

  private numberSetting(name: string, desc: string, key: keyof ZettelMergeSettings, min: number, max: number, step = 1): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addSlider(slider => slider
        .setLimits(min, max, step)
        .setDynamicTooltip()
        .setValue(Number(this.plugin.settings[key]))
        .onChange(async value => {
          (this.plugin.settings as any)[key] = value;
          await this.plugin.saveSettings();
        }))
      .addText(text => text
        .setValue(String(this.plugin.settings[key]))
        .onChange(async value => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return;
          (this.plugin.settings as any)[key] = Math.min(max, Math.max(min, parsed));
          await this.plugin.saveSettings();
        }));
  }

  private async refreshModels(button: ButtonComponent): Promise<void> {
    button.setDisabled(true).setButtonText("Refreshing...");
    try {
      const models = await new OpenAICompatibleClient(this.plugin.settings).listModelInfos();
      const allIds = this.unique(models.map(model => model.id));
      const embeddingModels = this.unique(models.filter(model => this.isEmbeddingModel(model)).map(model => model.id));
      const chatModels = this.unique(models.filter(model => !this.isEmbeddingModel(model)).map(model => model.id));

      this.plugin.settings.cachedModelIds = allIds;
      this.plugin.settings.cachedEmbeddingModels = this.withCurrentModel(embeddingModels, this.plugin.settings.embeddingModel);
      this.plugin.settings.cachedChatModels = this.withCurrentModel(
        chatModels.length ? chatModels : allIds.filter(id => !this.plugin.settings.cachedEmbeddingModels.includes(id)),
        this.plugin.settings.chatModel,
      );
      this.plugin.settings.modelsRefreshedAt = new Date().toISOString();

      if (!this.plugin.settings.cachedEmbeddingModels.length && allIds.length) {
        this.plugin.settings.cachedEmbeddingModels = this.withCurrentModel(allIds, this.plugin.settings.embeddingModel);
      }

      await this.plugin.saveSettings();
      new Notice(`Loaded ${allIds.length} model(s) from server.`);
      this.display();
    } catch (error) {
      new Notice(`Model refresh failed: ${(error as Error).message}`, 10000);
    } finally {
      button.setDisabled(false).setButtonText("Refresh");
    }
  }

  private withCurrentModel(models: string[], current: string): string[] {
    const out = this.unique(models);
    if (current && !out.includes(current)) out.unshift(current);
    return out;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  private clearModelCache(): void {
    this.plugin.settings.cachedChatModels = [];
    this.plugin.settings.cachedEmbeddingModels = [];
    this.plugin.settings.cachedModelIds = [];
    this.plugin.settings.modelsRefreshedAt = "";
  }

  private isEmbeddingModel(model: OpenAIModelInfo): boolean {
    const haystack = [
      model.id,
      model.type || "",
      model.object || "",
      model.owned_by || "",
      JSON.stringify(model.metadata || {}),
    ].join(" ").toLowerCase();
    return /\b(embed|embedding|embeddings|nomic|bge|e5|minilm|gte|jina-embeddings)\b/.test(haystack);
  }
}
