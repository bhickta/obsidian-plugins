import { App, FuzzySuggestModal, TFile } from "obsidian";
import { Notice } from "obsidian";
import type NoteMergerPlugin from "../main";

export class MergeWithModal extends FuzzySuggestModal<TFile> {
    plugin: NoteMergerPlugin;

    constructor(app: App, plugin: NoteMergerPlugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder("Type a note name to merge into the current note...");
    }

    getItems(): TFile[] {
        const active = this.app.workspace.getActiveFile();
        return this.app.vault.getMarkdownFiles()
            .filter(f => f.path !== active?.path)
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    getItemText(item: TFile): string { return item.path; }

    onChooseItem(item: TFile): void {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice("Open a target note first"); return; }
        this.plugin.executeMerge([item], active);
    }
}
