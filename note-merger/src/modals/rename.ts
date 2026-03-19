import { App, Modal, Notice, TFile, Setting } from "obsidian";

export class RenameModal extends Modal {
    file: TFile;
    suggestedName: string;

    constructor(app: App, file: TFile, suggestedName: string) {
        super(app);
        this.file = file;
        this.suggestedName = suggestedName;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Rename merged note" });
        contentEl.createEl("p", { text: "AI-suggested filename (edit if needed):", cls: "setting-item-description" });

        let newName = this.suggestedName;
        new Setting(contentEl).setName("Filename")
            .addText(t => { t.setValue(this.suggestedName); t.inputEl.style.width = "100%"; t.onChange(v => { newName = v; }); });

        const footer = contentEl.createDiv({ cls: "note-merger-footer" });
        footer.createEl("button", { text: "Rename", cls: "mod-cta" }).onclick = async () => {
            if (!newName.trim()) { new Notice("Filename cannot be empty."); return; }
            try {
                const dir = this.file.parent?.path || "";
                await this.app.fileManager.renameFile(this.file, dir ? `${dir}/${newName}.md` : `${newName}.md`);
                new Notice(`Renamed to: ${newName}.md`); this.close();
            } catch (e) { console.error(e); new Notice("Rename failed: " + (e as Error).message); }
        };
        footer.createEl("button", { text: "Skip" }).onclick = () => this.close();
    }

    onClose() { this.contentEl.empty(); }
}
