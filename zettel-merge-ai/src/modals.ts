import { App, Modal, Notice, TFile } from "obsidian";
import { MergeSuggestion } from "./types";

export class ProgressModal extends Modal {
  private statusEl!: HTMLElement;
  private logEl!: HTMLElement;
  private lastLine = "";

  constructor(app: App, private title: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("zettel-merge-ai-modal");
    contentEl.createEl("h2", { text: this.title });
    this.statusEl = contentEl.createDiv({ cls: "zettel-merge-ai-progress-status", text: "Starting..." });
    this.logEl = contentEl.createDiv({ cls: "zettel-merge-ai-progress-log" });
  }

  setStatus(text: string): void {
    if (!this.statusEl || !text) return;
    this.statusEl.setText(text);
    if (text === this.lastLine) return;
    this.lastLine = text;
    const row = this.logEl.createDiv({ cls: "zettel-merge-ai-progress-line" });
    row.setText(`${new Date().toLocaleTimeString()}  ${text}`);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class CandidateMergeModal extends Modal {
  private selected = new Set<string>();

  constructor(
    app: App,
    private active: TFile,
    private suggestions: MergeSuggestion[],
    private onMerge: (selected: MergeSuggestion[]) => Promise<void>,
  ) {
    super(app);
    for (const suggestion of suggestions) this.selected.add(suggestion.file.path);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("zettel-merge-ai-modal");

    contentEl.createEl("h2", { text: "Merge Candidates" });
    contentEl.createEl("p", {
      text: `Active note: ${this.active.path}`,
      cls: "zettel-merge-ai-meta",
    });

    const list = contentEl.createDiv({ cls: "zettel-merge-ai-list" });
    for (const suggestion of this.suggestions) {
      const row = list.createDiv({ cls: "zettel-merge-ai-candidate" });
      const checkbox = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
      checkbox.checked = this.selected.has(suggestion.file.path);
      checkbox.onchange = () => {
        if (checkbox.checked) this.selected.add(suggestion.file.path);
        else this.selected.delete(suggestion.file.path);
      };

      const main = row.createDiv();
      main.createDiv({ text: suggestion.file.basename, cls: "zettel-merge-ai-title" });
      main.createDiv({
        text: suggestion.file.path,
        cls: "zettel-merge-ai-meta",
      });

      row.createDiv({
        text: `${Math.round(suggestion.decision.confidence * 100)}%`,
        cls: "zettel-merge-ai-meta",
      });

      row.createDiv({
        text: `${suggestion.decision.risk.toUpperCase()} risk: ${suggestion.decision.reason}`,
        cls: "zettel-merge-ai-reason",
      });
    }

    const footer = contentEl.createDiv({ cls: "zettel-merge-ai-footer" });
    const status = footer.createSpan({ text: `${this.suggestions.length} mergeable candidate(s)`, cls: "zettel-merge-ai-status" });
    footer.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const mergeBtn = footer.createEl("button", { text: "Merge Selected", cls: "mod-cta" });
    mergeBtn.onclick = async () => {
      const selected = this.suggestions.filter(suggestion => this.selected.has(suggestion.file.path));
      if (!selected.length) {
        new Notice("No candidates selected.");
        return;
      }
      mergeBtn.disabled = true;
      status.setText("Merging...");
      try {
        await this.onMerge(selected);
        this.close();
      } catch (error) {
        console.error(error);
        new Notice(`Merge failed: ${(error as Error).message}`, 10000);
        mergeBtn.disabled = false;
        status.setText(`${this.suggestions.length} mergeable candidate(s)`);
      }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
