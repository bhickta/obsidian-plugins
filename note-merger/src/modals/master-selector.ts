import { Modal, App, TFile } from "obsidian";

export class MasterFileSelectorModal extends Modal {
    files: TFile[];
    onSelect: (masterFile: TFile) => void;

    constructor(app: App, files: TFile[], onSelect: (masterFile: TFile) => void) {
        super(app);
        this.files = files;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Select Master Note" });
        this.files.forEach(file => {
            const btn = contentEl.createEl("button", { text: file.basename, cls: "mod-cta" });
            btn.style.display = "block";
            btn.style.width = "100%";
            btn.style.marginBottom = "8px";
            btn.onclick = () => { this.onSelect(file); this.close(); };
        });
    }

    onClose() { this.contentEl.empty(); }
}
