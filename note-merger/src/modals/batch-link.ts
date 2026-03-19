import { Modal, App, TFile, Notice } from "obsidian";
import type NoteMergerPlugin from "../main";

export class BatchLinkMergeModal extends Modal {
    plugin: NoteMergerPlugin;
    resolvedFiles: TFile[] = [];
    private listEl!: HTMLElement;
    private countEl!: HTMLElement;
    private mergeBtn!: HTMLButtonElement;

    constructor(app: App, plugin: NoteMergerPlugin) { super(app); this.plugin = plugin; }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("note-merger-batch-modal");
        contentEl.createEl("h2", { text: "Batch Merge from Links" });
        contentEl.createEl("p", { text: "Paste wiki-links, bullet lists, or plain filenames.", cls: "setting-item-description" });

        const ta = contentEl.createEl("textarea", { cls: "note-merger-batch-input" });
        ta.placeholder = "Paste links here...\ne.g.\n- [[Note A]]\n- [[Note B]]";
        ta.rows = 8; ta.style.width = "100%"; ta.style.fontFamily = "var(--font-monospace)"; ta.style.fontSize = "13px"; ta.style.marginBottom = "12px";

        const parseBtn = contentEl.createEl("button", { text: "Resolve Links", cls: "mod-cta" });
        parseBtn.style.marginBottom = "16px";
        parseBtn.onclick = () => this.parseAndResolve(ta.value);
        ta.addEventListener("paste", () => { setTimeout(() => this.parseAndResolve(ta.value), 100); });

        this.countEl = contentEl.createDiv({ cls: "note-merger-batch-count" });
        this.countEl.setText("No files resolved yet.");
        this.listEl = contentEl.createDiv({ cls: "note-merger-batch-list" });

        const footer = contentEl.createDiv({ cls: "note-merger-footer" });
        this.mergeBtn = footer.createEl("button", { text: "Merge All", cls: "mod-cta" });
        this.mergeBtn.disabled = true;
        this.mergeBtn.onclick = () => this.handleMerge();
        footer.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    }

    parseAndResolve(text: string) {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice("Open a target note first"); return; }
        const names = new Set<string>();
        const wikiRe = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
        let m;
        while ((m = wikiRe.exec(text)) !== null) names.add(m[1].trim());
        if (names.size === 0) {
            for (const line of text.split("\n")) {
                const c = line.replace(/^[\s\-\*\\>•]+/, "").replace(/\.md$/i, "").trim();
                if (c.length > 0) names.add(c);
            }
        }
        this.resolvedFiles = [];
        const notFound: string[] = [];
        for (const name of names) {
            const file = this.app.metadataCache.getFirstLinkpathDest(name, active.path);
            if (file && file.path !== active.path) {
                if (!this.resolvedFiles.some(f => f.path === file.path)) this.resolvedFiles.push(file);
            } else if (!file) notFound.push(name);
        }
        this.renderList();
        if (notFound.length > 0) new Notice(`${notFound.length} link(s) not found: ${notFound.slice(0, 3).join(", ")}${notFound.length > 3 ? "..." : ""}`);
    }

    renderList() {
        this.listEl.empty();
        if (!this.resolvedFiles.length) { this.countEl.setText("No files resolved."); this.mergeBtn.disabled = true; return; }
        this.countEl.setText(`${this.resolvedFiles.length} file(s) ready:`);
        this.mergeBtn.disabled = false;
        this.resolvedFiles.forEach((file, i) => {
            const row = this.listEl.createDiv({ cls: "note-merger-batch-item" });
            row.createSpan({ text: file.basename, cls: "note-merger-batch-name" });
            row.createSpan({ text: file.parent?.path || "/", cls: "note-merger-batch-path" });
            row.createEl("button", { text: "✕", cls: "note-merger-batch-remove" }).onclick = () => { this.resolvedFiles.splice(i, 1); this.renderList(); };
        });
    }

    async handleMerge() {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice("Open a target note first"); return; }
        if (!this.resolvedFiles.length) { new Notice("No files to merge"); return; }
        this.close();
        await this.plugin.executeMerge(this.resolvedFiles, active);
    }

    onClose() { this.contentEl.empty(); }
}
