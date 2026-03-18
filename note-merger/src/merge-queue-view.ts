import { ItemView, WorkspaceLeaf, TFile, Notice, App } from "obsidian";
import type NoteMergerPlugin from "./main";

export const MERGE_QUEUE_VIEW_TYPE = "note-merger-queue";

export class MergeQueueView extends ItemView {
    plugin: NoteMergerPlugin;
    queuedFiles: TFile[] = [];
    private listEl!: HTMLElement;
    private countEl!: HTMLElement;
    private dropZone!: HTMLElement;
    private mergeBtn!: HTMLButtonElement;

    constructor(leaf: WorkspaceLeaf, plugin: NoteMergerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return MERGE_QUEUE_VIEW_TYPE; }
    getDisplayText(): string { return "Merge Queue"; }
    getIcon(): string { return "git-merge"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("note-merger-queue-container");

        // Header
        const header = container.createDiv({ cls: "note-merger-queue-header" });
        header.createEl("h4", { text: "Merge Queue" });

        // Drop zone
        this.dropZone = container.createDiv({ cls: "note-merger-drop-zone" });
        this.dropZone.createDiv({ cls: "note-merger-drop-icon", text: "⊕" });
        this.dropZone.createDiv({ cls: "note-merger-drop-text", text: "Drag notes here from Smart Connections" });

        this.setupDropZone();

        // Count
        this.countEl = container.createDiv({ cls: "note-merger-queue-count" });

        // File list
        this.listEl = container.createDiv({ cls: "note-merger-queue-list" });

        // Footer buttons
        const footer = container.createDiv({ cls: "note-merger-queue-footer" });

        this.mergeBtn = footer.createEl("button", { text: "Merge All into Active Note", cls: "mod-cta note-merger-queue-merge-btn" });
        this.mergeBtn.disabled = true;
        this.mergeBtn.onclick = () => this.handleMerge();

        const clearBtn = footer.createEl("button", { text: "Clear", cls: "note-merger-queue-clear-btn" });
        clearBtn.onclick = () => { this.queuedFiles = []; this.renderList(); };

        this.renderList();
    }

    private setupDropZone() {
        // Handle drag over
        this.dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.addClass("drag-over");
        });

        this.dropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            this.dropZone.removeClass("drag-over");
        });

        // Handle drop
        this.dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.removeClass("drag-over");
            this.handleDrop(e);
        });

        // Also allow dropping anywhere in the container
        const container = this.containerEl.children[1] as HTMLElement;
        container.addEventListener("dragover", (e) => {
            e.preventDefault();
            this.dropZone.addClass("drag-over");
        });
        container.addEventListener("dragleave", () => {
            this.dropZone.removeClass("drag-over");
        });
        container.addEventListener("drop", (e) => {
            e.preventDefault();
            this.dropZone.removeClass("drag-over");
            this.handleDrop(e);
        });
    }

    private handleDrop(e: DragEvent) {
        const activeFile = this.app.workspace.getActiveFile();

        // Try multiple data formats that Obsidian/plugins use
        const data = e.dataTransfer;
        if (!data) return;

        // 1. Check for Obsidian internal file drag (text/plain usually has the path)
        const textData = data.getData("text/plain");
        const htmlData = data.getData("text/html");
        const uriData = data.getData("text/uri-list");

        // Collect all potential file references
        const candidates: string[] = [];

        // Parse wiki-links from any text
        if (textData) {
            const wikiRegex = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
            let match;
            while ((match = wikiRegex.exec(textData)) !== null) {
                candidates.push(match[1].trim());
            }
            // If no wiki-links, try as plain filename/path
            if (candidates.length === 0) {
                const lines = textData.split("\n");
                for (const line of lines) {
                    const cleaned = line.replace(/^[\s\-\*\>•]+/, "").replace(/\.md$/i, "").trim();
                    if (cleaned.length > 0) candidates.push(cleaned);
                }
            }
        }

        // Parse links from HTML (Smart Connections often uses this)
        if (htmlData && candidates.length === 0) {
            const linkRegex = /data-href="([^"]+)"/g;
            let match;
            while ((match = linkRegex.exec(htmlData)) !== null) {
                candidates.push(match[1].replace(/\.md$/i, "").trim());
            }
            // Also try anchor text
            const anchorRegex = /<a[^>]*>([^<]+)<\/a>/g;
            while ((match = anchorRegex.exec(htmlData)) !== null) {
                const text = match[1].replace(/\.md$/i, "").trim();
                if (text.length > 0) candidates.push(text);
            }
        }

        // Parse URI list
        if (uriData && candidates.length === 0) {
            for (const uri of uriData.split("\n")) {
                const cleaned = decodeURIComponent(uri).replace(/\.md$/i, "").trim();
                if (cleaned.length > 0) candidates.push(cleaned);
            }
        }

        // Resolve candidates to files
        let added = 0;
        for (const name of candidates) {
            const file = this.app.metadataCache.getFirstLinkpathDest(name, activeFile?.path || "");
            if (file && !this.queuedFiles.some(f => f.path === file.path)) {
                if (!activeFile || file.path !== activeFile.path) {
                    this.queuedFiles.push(file);
                    added++;
                }
            }
        }

        if (added > 0) {
            this.renderList();
            new Notice(`Added ${added} note(s) to merge queue`);
        } else if (candidates.length > 0) {
            new Notice("Could not resolve dropped items to notes");
        }
    }

    renderList() {
        this.listEl.empty();

        if (this.queuedFiles.length === 0) {
            this.countEl.setText("");
            this.mergeBtn.disabled = true;
            this.dropZone.style.display = "";
            return;
        }

        this.dropZone.style.display = "none";
        this.countEl.setText(`${this.queuedFiles.length} note(s) queued:`);
        this.mergeBtn.disabled = false;

        this.queuedFiles.forEach((file, idx) => {
            const row = this.listEl.createDiv({ cls: "note-merger-queue-item" });
            row.createSpan({ text: file.basename, cls: "note-merger-queue-name" });

            const removeBtn = row.createEl("button", { text: "✕", cls: "note-merger-queue-remove" });
            removeBtn.onclick = () => {
                this.queuedFiles.splice(idx, 1);
                this.renderList();
            };
        });

        // Show the drop zone below the list as a smaller "add more" zone
        const addMore = this.listEl.createDiv({ cls: "note-merger-drop-zone small" });
        addMore.setText("+ Drop more notes here");
        addMore.addEventListener("dragover", (e) => { e.preventDefault(); addMore.addClass("drag-over"); });
        addMore.addEventListener("dragleave", () => addMore.removeClass("drag-over"));
        addMore.addEventListener("drop", (e) => { e.preventDefault(); addMore.removeClass("drag-over"); this.handleDrop(e); });
    }

    async handleMerge() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("Open a target note first");
            return;
        }
        if (this.queuedFiles.length === 0) {
            new Notice("No files in queue");
            return;
        }

        const filesToMerge = [...this.queuedFiles];
        this.queuedFiles = [];
        this.renderList();

        await this.plugin.executeMerge(filesToMerge, activeFile);
    }

    async onClose() {
        // nothing to clean up
    }
}
