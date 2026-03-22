import { Modal, App, TFile, TFolder, Notice } from "obsidian";

export class CopyContentModal extends Modal {
    private files: TFile[] = [];
    private sourceName: string;
    private selected: Set<string> = new Set();
    private listEl!: HTMLElement;
    private countEl!: HTMLElement;
    private copyBtn!: HTMLButtonElement;

    constructor(app: App, files: TFile[], sourceName: string) {
        super(app);
        this.files = files;
        this.sourceName = sourceName;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("note-merger-copy-modal");
        contentEl.createEl("h2", { text: "Copy Content from Files" });

        const desc = contentEl.createEl("p", { cls: "setting-item-description" });
        desc.setText(`Select files from "${this.sourceName}" to copy their content to clipboard.`);

        if (this.files.length === 0) {
            contentEl.createEl("p", { text: "No markdown files found." });
            return;
        }

        // Select All / Select None buttons
        const toolbarEl = contentEl.createDiv({ cls: "note-merger-copy-toolbar" });
        toolbarEl.style.display = "flex";
        toolbarEl.style.gap = "8px";
        toolbarEl.style.marginBottom = "8px";

        const selectAllBtn = toolbarEl.createEl("button", { text: "Select All" });
        selectAllBtn.onclick = () => {
            this.files.forEach(f => this.selected.add(f.path));
            this.renderList();
        };

        const selectNoneBtn = toolbarEl.createEl("button", { text: "Select None" });
        selectNoneBtn.onclick = () => {
            this.selected.clear();
            this.renderList();
        };

        this.countEl = contentEl.createDiv({ cls: "note-merger-copy-count" });
        this.countEl.style.marginBottom = "8px";
        this.countEl.style.fontSize = "12px";
        this.countEl.style.color = "var(--text-muted)";

        this.listEl = contentEl.createDiv({ cls: "note-merger-copy-list" });
        this.listEl.style.maxHeight = "400px";
        this.listEl.style.overflowY = "auto";
        this.listEl.style.border = "1px solid var(--background-modifier-border)";
        this.listEl.style.borderRadius = "6px";
        this.listEl.style.padding = "4px";
        this.listEl.style.marginBottom = "12px";

        // Footer
        const footer = contentEl.createDiv({ cls: "note-merger-footer" });
        footer.style.display = "flex";
        footer.style.gap = "8px";
        footer.style.justifyContent = "flex-end";

        this.copyBtn = footer.createEl("button", { text: "📋 Copy to Clipboard", cls: "mod-cta" });
        this.copyBtn.disabled = true;
        this.copyBtn.onclick = () => this.handleCopy();

        const cancelBtn = footer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();

        this.renderList();
    }

    renderList() {
        this.listEl.empty();
        this.countEl.setText(`${this.selected.size} of ${this.files.length} file(s) selected`);
        this.copyBtn.disabled = this.selected.size === 0;

        this.files.forEach(file => {
            const row = this.listEl.createDiv({ cls: "note-merger-copy-item" });
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.padding = "4px 8px";
            row.style.cursor = "pointer";
            row.style.borderRadius = "4px";

            const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
            cb.checked = this.selected.has(file.path);
            cb.style.marginRight = "8px";
            cb.style.cursor = "pointer";

            const label = row.createSpan({ text: file.basename });
            label.style.flex = "1";
            label.style.cursor = "pointer";

            // Click anywhere on the row to toggle
            row.onclick = (e) => {
                if (e.target === cb) return; // Let checkbox handle its own click
                if (this.selected.has(file.path)) {
                    this.selected.delete(file.path);
                } else {
                    this.selected.add(file.path);
                }
                this.renderList();
            };
            cb.onchange = () => {
                if (cb.checked) this.selected.add(file.path);
                else this.selected.delete(file.path);
                this.countEl.setText(`${this.selected.size} of ${this.files.length} file(s) selected`);
                this.copyBtn.disabled = this.selected.size === 0;
            };

            // Hover effect
            row.onmouseenter = () => { row.style.backgroundColor = "var(--background-modifier-hover)"; };
            row.onmouseleave = () => { row.style.backgroundColor = ""; };
        });
    }

    async handleCopy() {
        const selectedFiles = this.files.filter(f => this.selected.has(f.path));
        if (!selectedFiles.length) { new Notice("No files selected"); return; }

        const parts: string[] = [];
        for (const file of selectedFiles) {
            const content = await this.app.vault.read(file);
            // Strip YAML frontmatter
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
            parts.push(`---\nSource: ${file.basename}\n---\n\n${body}`);
        }

        const combined = parts.join("\n\n");
        await navigator.clipboard.writeText(combined);
        new Notice(`📋 Copied content from ${selectedFiles.length} file(s) to clipboard!`);
        this.close();
    }

    onClose() { this.contentEl.empty(); }
}
