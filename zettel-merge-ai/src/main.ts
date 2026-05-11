import { Notice, Plugin, TFile } from "obsidian";
import { CandidateMergeModal, ProgressModal } from "./modals";
import { MergeEngine } from "./merge-engine";
import { ZettelMergeSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, ZettelMergeSettings } from "./types";
import { isVisibleMarkdownInScope } from "./utils";

export default class ZettelMergeAIPlugin extends Plugin {
  settings!: ZettelMergeSettings;
  private statusBarEl: HTMLElement | null = null;
  private autoSuggestTimer: number | null = null;
  private modalOpen = false;
  private progressModal: ProgressModal | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.statusBarEl = this.addStatusBarItem();
    this.addSettingTab(new ZettelMergeSettingTab(this.app, this));

    this.addRibbonIcon("git-merge", "Suggest merge candidates", () => {
      void this.runSuggestCommand();
    });

    this.addCommand({
      id: "suggest-merge-candidates",
      name: "Suggest merge candidates for active note",
      callback: () => void this.runSuggestCommand(),
    });

    this.addCommand({
      id: "auto-merge-active-note",
      name: "Auto-merge active note with high-confidence candidates",
      callback: () => void this.runAutoMergeCommand(),
    });

    this.addCommand({
      id: "clear-embedding-cache",
      name: "Clear embedding cache",
      callback: () => void this.runSafely(engine => engine.clearEmbeddingCache()),
    });

    this.addCommand({
      id: "build-full-embedding-index",
      name: "Build full embedding index",
      callback: () => void this.withProgress("Building Full Embedding Index", engine => engine.buildFullEmbeddingIndex()),
    });

    this.addCommand({
      id: "restore-latest-merge",
      name: "Restore latest applied merge from archive",
      callback: () => void this.runSafely(engine => engine.restoreLatestAppliedMerge()),
    });

    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (file instanceof TFile) this.scheduleAutoSuggest(file);
    }));
  }

  onunload(): void {
    if (this.autoSuggestTimer !== null) window.clearTimeout(this.autoSuggestTimer);
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (!this.settings.suggestionModel) {
      this.settings.suggestionModel = this.settings.chatModel;
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  setStatus(text: string): void {
    if (this.statusBarEl) this.statusBarEl.setText(text);
    if (this.progressModal && text) this.progressModal.setStatus(text);
  }

  async buildFullEmbeddingIndexFromSettings(): Promise<void> {
    await this.withProgress("Building Full Embedding Index", engine => engine.buildFullEmbeddingIndex());
  }

  private engine(): MergeEngine {
    return new MergeEngine(this.app, this.settings, text => this.setStatus(text));
  }

  private async runSuggestCommand(): Promise<void> {
    await this.withProgress("Finding Merge Candidates", async engine => {
      const active = this.requireActiveNote();
      const suggestions = await engine.suggestForActive(false);
      if (suggestions.length) this.openCandidateModal(active, suggestions);
    });
  }

  private async runAutoMergeCommand(): Promise<void> {
    await this.withProgress("Auto-merging Active Note", engine => engine.autoMergeActive());
  }

  private async runSafely(task: (engine: MergeEngine) => Promise<void>): Promise<void> {
    try {
      await task(this.engine());
    } catch (error) {
      console.error(error);
      this.setStatus("");
      new Notice(`Zettel Merge AI: ${(error as Error).message}`, 10000);
    }
  }

  private async withProgress(title: string, task: (engine: MergeEngine) => Promise<void>): Promise<void> {
    if (this.progressModal) this.progressModal.close();
    this.progressModal = new ProgressModal(this.app, title);
    this.progressModal.open();
    try {
      await this.runSafely(task);
    } finally {
      const modal = this.progressModal;
      window.setTimeout(() => {
        if (this.progressModal === modal) {
          modal?.close();
          this.progressModal = null;
        }
      }, 1200);
    }
  }

  private scheduleAutoSuggest(file: TFile): void {
    if (!this.settings.autoSuggestOnOpen) return;
    if (this.modalOpen) return;
    if (!isVisibleMarkdownInScope(file, this.settings.rootFolder, this.settings.dataFolder)) return;
    if (this.autoSuggestTimer !== null) window.clearTimeout(this.autoSuggestTimer);

    this.autoSuggestTimer = window.setTimeout(() => {
      this.autoSuggestTimer = null;
      void this.runSafely(async engine => {
        const active = this.requireActiveNote();
        if (active.path !== file.path) return;
        const suggestions = await engine.suggestForActive(true);
        if (suggestions.length && !this.modalOpen) this.openCandidateModal(active, suggestions);
      });
    }, 1200);
  }

  private openCandidateModal(active: TFile, suggestions: any[]): void {
    this.modalOpen = true;
    const modal = new CandidateMergeModal(this.app, active, suggestions, async selected => {
      await this.withProgress("Merging Selected Notes", engine => engine.mergeIntoActive(active, selected));
    });
    const originalClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      this.modalOpen = false;
      originalClose();
    };
    modal.open();
  }

  private requireActiveNote(): TFile {
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== "md") throw new Error("Open a markdown note first.");
    return active;
  }
}
