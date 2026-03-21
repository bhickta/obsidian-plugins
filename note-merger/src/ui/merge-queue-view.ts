import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import type NoteMergerPlugin from "../main";

export const MERGE_QUEUE_VIEW_TYPE = "note-merger-queue";

export class MergeQueueView extends ItemView {
    plugin: NoteMergerPlugin;
    queuedFiles: TFile[] = [];
    private listEl!: HTMLElement;
    private countEl!: HTMLElement;
    private dropZone!: HTMLElement;
    private mergeBtn!: HTMLButtonElement;
    private importBtn!: HTMLButtonElement;

    constructor(leaf: WorkspaceLeaf, plugin: NoteMergerPlugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return MERGE_QUEUE_VIEW_TYPE; }
    getDisplayText() { return "Merge Queue"; }
    getIcon() { return "git-merge"; }

    async onOpen() {
        const c = this.containerEl.children[1] as HTMLElement;
        c.empty(); c.addClass("note-merger-queue-container");
        c.createDiv({ cls: "note-merger-queue-header" }).createEl("h4", { text: "Merge Queue" });

        // Import from Smart Connections button
        this.importBtn = c.createEl("button", { text: "⬇ Import from Smart Connections", cls: "note-merger-import-sc-btn" });
        this.importBtn.onclick = () => this.importFromSmartConnections();

        this.dropZone = c.createDiv({ cls: "note-merger-drop-zone" });
        this.dropZone.createDiv({ cls: "note-merger-drop-icon", text: "⊕" });
        this.dropZone.createDiv({ cls: "note-merger-drop-text", text: "Drag notes here or use Import button above" });
        this.setupDragHandlers(this.dropZone);
        this.setupDragHandlers(c);

        this.countEl = c.createDiv({ cls: "note-merger-queue-count" });
        this.listEl = c.createDiv({ cls: "note-merger-queue-list" });

        const footer = c.createDiv({ cls: "note-merger-queue-footer" });
        this.mergeBtn = footer.createEl("button", { text: "Merge All into Active Note", cls: "mod-cta note-merger-queue-merge-btn" });
        this.mergeBtn.disabled = true;
        this.mergeBtn.onclick = () => this.handleMerge();
        footer.createEl("button", { text: "Clear", cls: "note-merger-queue-clear-btn" }).onclick = () => { this.queuedFiles = []; this.renderList(); };
        this.renderList();
    }

    private importFromSmartConnections() {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice("Open a target note first"); return; }

        // Find the Smart Connections view container
        const scLeaves = this.app.workspace.getLeavesOfType("smart-connections-view");
        if (!scLeaves.length) { new Notice("Smart Connections panel not open"); return; }

        let added = 0;
        for (const leaf of scLeaves) {
            const scContainer = leaf.view.containerEl;
            // Query all visible .sc-result elements with data-path
            const results = scContainer.querySelectorAll(".sc-result[data-path]");
            for (const el of Array.from(results)) {
                const htmlEl = el as HTMLElement;
                // Skip hidden results
                if (htmlEl.dataset.hidden === "true" || htmlEl.style.display === "none") continue;

                const filePath = htmlEl.dataset.path;
                if (!filePath) continue;

                // Resolve .md path
                const fullPath = filePath.endsWith(".md") ? filePath : filePath + ".md";
                const file = this.app.vault.getAbstractFileByPath(fullPath);
                if (!(file instanceof TFile)) continue;
                if (file.path === active.path) continue; // skip the active note itself
                if (this.queuedFiles.some(f => f.path === file.path)) continue; // skip duplicates

                this.queuedFiles.push(file);
                added++;
            }
        }

        if (added > 0) {
            this.renderList();
            new Notice(`Imported ${added} note(s) from Smart Connections`);
        } else {
            new Notice("No new notes found in Smart Connections panel");
        }
    }

    private setupDragHandlers(el: HTMLElement) {
        el.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); this.dropZone.addClass("drag-over"); });
        el.addEventListener("dragleave", e => { e.preventDefault(); this.dropZone.removeClass("drag-over"); });
        el.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); this.dropZone.removeClass("drag-over"); this.handleDrop(e); });
    }

    private handleDrop(e: DragEvent) {
        const active = this.app.workspace.getActiveFile();
        const data = e.dataTransfer;
        if (!data) return;
        const candidates: string[] = [];
        const text = data.getData("text/plain"), html = data.getData("text/html"), uri = data.getData("text/uri-list");

        if (text) {
            const wikiRe = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
            let m; while ((m = wikiRe.exec(text)) !== null) candidates.push(m[1].trim());
            if (!candidates.length) text.split("\n").forEach(l => { const c = l.replace(/^[\s\-\*\\>•]+/, "").replace(/\.md$/i, "").trim(); if (c) candidates.push(c); });
        }
        if (html && !candidates.length) {
            let m; const linkRe = /data-href="([^"]+)"/g;
            while ((m = linkRe.exec(html)) !== null) candidates.push(m[1].replace(/\.md$/i, "").trim());
            const anchorRe = /<a[^>]*>([^<]+)<\/a>/g;
            while ((m = anchorRe.exec(html)) !== null) { const t = m[1].replace(/\.md$/i, "").trim(); if (t) candidates.push(t); }
        }
        if (uri && !candidates.length) uri.split("\n").forEach(u => { const c = decodeURIComponent(u).replace(/\.md$/i, "").trim(); if (c) candidates.push(c); });

        let added = 0;
        for (const name of candidates) {
            const file = this.app.metadataCache.getFirstLinkpathDest(name, active?.path || "");
            if (file && !this.queuedFiles.some(f => f.path === file.path) && (!active || file.path !== active.path)) { this.queuedFiles.push(file); added++; }
        }
        if (added > 0) { this.renderList(); new Notice(`Added ${added} note(s) to queue`); }
        else if (candidates.length) new Notice("Could not resolve dropped items");
    }

    renderList() {
        this.listEl.empty();
        if (!this.queuedFiles.length) { this.countEl.setText(""); this.mergeBtn.disabled = true; this.dropZone.style.display = ""; this.importBtn.style.display = ""; return; }
        this.dropZone.style.display = "none";
        this.importBtn.style.display = "none";
        this.countEl.setText(`${this.queuedFiles.length} note(s) queued:`);
        this.mergeBtn.disabled = false;
        this.queuedFiles.forEach((file, i) => {
            const row = this.listEl.createDiv({ cls: "note-merger-queue-item" });
            row.createSpan({ text: file.basename, cls: "note-merger-queue-name" });
            row.createEl("button", { text: "✕", cls: "note-merger-queue-remove" }).onclick = () => { this.queuedFiles.splice(i, 1); this.renderList(); };
        });
        const addMore = this.listEl.createDiv({ cls: "note-merger-drop-zone small" }); addMore.setText("+ Drop more");
        this.setupDragHandlers(addMore);
    }

    async handleMerge() {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice("Open a target note first"); return; }
        if (!this.queuedFiles.length) { new Notice("No files in queue"); return; }
        const files = [...this.queuedFiles]; this.queuedFiles = []; this.renderList();
        await this.plugin.executeMerge(files, active);
    }

    async onClose() {}
}
