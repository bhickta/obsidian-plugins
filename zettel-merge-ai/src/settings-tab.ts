import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import ZettelMergeAIPlugin from "./main";
import { DEFAULT_MERGE_PROMPT, ZettelMergeSettings } from "./types";
import { OpenAICompatibleClient } from "./openai-client";

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
    this.textSetting("Base URL", "Example: http://127.0.0.1:1234/v1 for LM Studio / lms-server.", "baseUrl");
    new Setting(containerEl)
      .setName("API key")
      .setDesc("Optional for local servers. Sent as Bearer token only when non-empty.")
      .addText(text => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.apiKey).onChange(async value => {
          this.plugin.settings.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });
    this.textSetting("Chat model", "Model used for merge decisions, merge generation, and validation.", "chatModel");
    this.textSetting("Embedding model", "OpenAI-compatible embeddings model.", "embeddingModel");

    new Setting(containerEl)
      .setName("Test / list models")
      .setDesc("Calls GET /models on the configured base URL.")
      .addButton(button => button.setButtonText("List").onClick(async () => {
        button.setDisabled(true).setButtonText("Loading...");
        try {
          const models = await new OpenAICompatibleClient(this.plugin.settings).listModels();
          new Notice(models.length ? models.slice(0, 20).join("\n") : "No models returned.", 12000);
        } catch (error) {
          new Notice(`Model list failed: ${(error as Error).message}`, 10000);
        } finally {
          button.setDisabled(false).setButtonText("List");
        }
      }));

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
}
