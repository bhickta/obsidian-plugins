import { Plugin, TFile, Notice, Modal, App, Setting, FuzzySuggestModal, MarkdownView, MarkdownFileInfo, Editor } from "obsidian";
import { DEFAULT_SETTINGS, NoteMergerSettingTab, PluginSettings } from "./settings";
import { mergeWithRetry } from "./merger";
import { MergeReviewModal } from "./modal";
import { MergeQueueView, MERGE_QUEUE_VIEW_TYPE } from "./merge-queue-view";
import { KeyManager } from "./keyManager";

class MasterFileSelectorModal extends Modal {
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

/**
 * Fuzzy file search modal for "Merge with..." command.
 */
class MergeWithModal extends FuzzySuggestModal<TFile> {
    plugin: NoteMergerPlugin;

    constructor(app: App, plugin: NoteMergerPlugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder("Type a note name to merge into the current note...");
    }

    getItems(): TFile[] {
        const activeFile = this.app.workspace.getActiveFile();
        return this.app.vault.getMarkdownFiles()
            .filter(f => f.path !== activeFile?.path)
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    getItemText(item: TFile): string { return item.path; }

    onChooseItem(item: TFile): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) { new Notice("Open a target note first"); return; }
        this.plugin.executeMerge([item], activeFile);
    }
}

/**
 * Batch link merge modal: paste/drop multiple [[links]], resolve to files, merge all at once.
 * Works with Smart Connections' "Copy as list of links" output.
 */
class BatchLinkMergeModal extends Modal {
    plugin: NoteMergerPlugin;
    resolvedFiles: TFile[] = [];
    listEl!: HTMLElement;
    countEl!: HTMLElement;
    mergeBtn!: HTMLButtonElement;

    constructor(app: App, plugin: NoteMergerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("note-merger-batch-modal");

        contentEl.createEl("h2", { text: "Batch Merge from Links" });
        contentEl.createEl("p", {
            text: "Paste links below — wiki-links, bullet lists, or plain filenames. Works with Smart Connections → 'Copy as list of links'.",
            cls: "setting-item-description"
        });

        const textArea = contentEl.createEl("textarea", { cls: "note-merger-batch-input" });
        textArea.placeholder = "Paste links here...\ne.g.\n- [[Tenth Five Year Plan (2002-2007)]]\n- [[Digital Economy Vision (ES23)]]\n\nOr plain filenames:\nTenth Five Year Plan (2002-2007)\nDigital Economy Vision (ES23)";
        textArea.rows = 8;
        textArea.style.width = "100%";
        textArea.style.fontFamily = "var(--font-monospace)";
        textArea.style.fontSize = "13px";
        textArea.style.marginBottom = "12px";

        const parseBtn = contentEl.createEl("button", { text: "Resolve Links", cls: "mod-cta" });
        parseBtn.style.marginBottom = "16px";
        parseBtn.onclick = () => this.parseAndResolve(textArea.value);

        // Auto-parse on paste
        textArea.addEventListener("paste", () => {
            setTimeout(() => this.parseAndResolve(textArea.value), 100);
        });

        this.countEl = contentEl.createDiv({ cls: "note-merger-batch-count" });
        this.countEl.setText("No files resolved yet.");
        this.listEl = contentEl.createDiv({ cls: "note-merger-batch-list" });

        const footer = contentEl.createDiv({ cls: "note-merger-footer" });
        this.mergeBtn = footer.createEl("button", { text: "Merge All", cls: "mod-cta" });
        this.mergeBtn.disabled = true;
        this.mergeBtn.onclick = () => this.handleMerge();

        const cancelBtn = footer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();
    }

    parseAndResolve(text: string) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) { new Notice("Open a target note first"); return; }

        const names = new Set<string>();

        // 1. Wiki-links: [[Note Name]], [[Note Name|Display]], [[Note Name#Heading]]
        const wikiRegex = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
        let match;
        while ((match = wikiRegex.exec(text)) !== null) {
            names.add(match[1].trim());
        }

        // 2. Fallback: plain filenames, one per line
        if (names.size === 0) {
            for (const line of text.split("\n")) {
                const cleaned = line.replace(/^[\s\-\*\>•]+/, "").replace(/\.md$/i, "").trim();
                if (cleaned.length > 0) names.add(cleaned);
            }
        }

        this.resolvedFiles = [];
        const notFound: string[] = [];

        for (const name of names) {
            const file = this.app.metadataCache.getFirstLinkpathDest(name, activeFile.path);
            if (file && file.path !== activeFile.path) {
                if (!this.resolvedFiles.some(f => f.path === file.path)) {
                    this.resolvedFiles.push(file);
                }
            } else if (!file) {
                notFound.push(name);
            }
        }

        this.renderFileList();
        if (notFound.length > 0) {
            new Notice(`${notFound.length} link(s) not found: ${notFound.slice(0, 3).join(", ")}${notFound.length > 3 ? "..." : ""}`);
        }
    }

    renderFileList() {
        this.listEl.empty();
        if (this.resolvedFiles.length === 0) {
            this.countEl.setText("No files resolved.");
            this.mergeBtn.disabled = true;
            return;
        }

        this.countEl.setText(`${this.resolvedFiles.length} file(s) ready to merge:`);
        this.mergeBtn.disabled = false;

        this.resolvedFiles.forEach((file, idx) => {
            const row = this.listEl.createDiv({ cls: "note-merger-batch-item" });
            row.createSpan({ text: file.basename, cls: "note-merger-batch-name" });
            row.createSpan({ text: file.parent?.path || "/", cls: "note-merger-batch-path" });
            const removeBtn = row.createEl("button", { text: "✕", cls: "note-merger-batch-remove" });
            removeBtn.onclick = () => { this.resolvedFiles.splice(idx, 1); this.renderFileList(); };
        });
    }

    async handleMerge() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) { new Notice("Open a target note first"); return; }
        if (this.resolvedFiles.length === 0) { new Notice("No files to merge"); return; }
        this.close();
        await this.plugin.executeMerge(this.resolvedFiles, activeFile);
    }

    onClose() { this.contentEl.empty(); }
}

export default class NoteMergerPlugin extends Plugin {
    settings!: PluginSettings;
    private statusBarEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.setText("");

        // Register the merge queue sidebar view
        this.registerView(MERGE_QUEUE_VIEW_TYPE, (leaf) => new MergeQueueView(leaf, this));

        // Right-click single file
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && file.extension === "md") {
                    menu.addItem((item) => {
                        item.setTitle("Merge into current note").setIcon("git-merge")
                            .onClick(async () => {
                                const activeFile = this.app.workspace.getActiveFile();
                                if (!activeFile) { new Notice("Open a target note first"); return; }
                                if (activeFile.path === file.path) { new Notice("Cannot merge a note into itself"); return; }
                                await this.executeMerge([file], activeFile);
                            });
                    });
                }
            })
        );

        // Right-click multi-file
        this.registerEvent(
            this.app.workspace.on("files-menu", (menu, files) => {
                const mdFiles = files.filter(f => f instanceof TFile && f.extension === "md") as TFile[];
                if (mdFiles.length >= 2) {
                    menu.addItem((item) => {
                        item.setTitle(`Merge ${mdFiles.length} selected files`).setIcon("git-merge")
                            .onClick(() => {
                                new MasterFileSelectorModal(this.app, mdFiles, async (masterFile) => {
                                    const sourceFiles = mdFiles.filter(f => f.path !== masterFile.path);
                                    await this.executeMerge(sourceFiles, masterFile);
                                }).open();
                            });
                    });
                }
            })
        );

        // Ctrl+P: "Merge with..." — fuzzy file search
        this.addCommand({
            id: 'merge-with',
            name: 'Merge with...',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return false;
                if (!checking) new MergeWithModal(this.app, this).open();
                return true;
            }
        });

        // Ctrl+P: "Merge linked note" — reads [[link]] under cursor
        this.addCommand({
            id: 'merge-linked-note',
            name: 'Merge linked note under cursor',
            editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                const activeFile = ctx.file;
                if (!activeFile) { new Notice("No active file"); return; }

                const cursor = editor.getCursor();
                const line = editor.getLine(cursor.line);
                const linkRegex = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
                let match;
                let linkedName: string | null = null;

                while ((match = linkRegex.exec(line)) !== null) {
                    if (cursor.ch >= match.index && cursor.ch <= match.index + match[0].length) {
                        linkedName = match[1];
                        break;
                    }
                }

                if (!linkedName) { new Notice("Place your cursor on a [[wiki-link]] first"); return; }

                const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkedName, activeFile.path);
                if (!linkedFile) { new Notice(`Note not found: "${linkedName}"`); return; }
                if (linkedFile.path === activeFile.path) { new Notice("Cannot merge a note into itself"); return; }

                await this.executeMerge([linkedFile], activeFile);
            }
        });

        // Ctrl+P: "Batch merge from links" — paste/drop multiple links
        this.addCommand({
            id: 'batch-merge-links',
            name: 'Batch merge from links',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return false;
                if (!checking) new BatchLinkMergeModal(this.app, this).open();
                return true;
            }
        });

        // Ctrl+P: "Open merge queue" — sidebar panel
        this.addCommand({
            id: 'open-merge-queue',
            name: 'Open merge queue panel',
            callback: () => this.activateMergeQueue()
        });

        this.addSettingTab(new NoteMergerSettingTab(this.app, this));
    }

    async activateMergeQueue() {
        const { workspace } = this.app;
        
        // Use type assertion to avoid `WorkspaceLeaf | null` type errors
        let leaf: any = workspace.getLeavesOfType(MERGE_QUEUE_VIEW_TYPE)[0];
        
        if (!leaf) {
            // Force it to open in a split BELOW the current active right panel (e.g. Smart Connections)
            // instead of opening as a separate tab on top.
            const existingLeaves = workspace.getLeavesOfType("smart-connections-view");
            const targetLeaf = existingLeaves.length > 0 ? existingLeaves[0] : workspace.getRightLeaf(false);
            
            if (targetLeaf) {
                // Split horizontally (which in vertical sidebars creates a top/bottom split)
                leaf = workspace.createLeafBySplit(targetLeaf, "horizontal");
            } else {
                leaf = workspace.getRightLeaf(false);
            }

            if (leaf) {
                await leaf.setViewState({
                    type: MERGE_QUEUE_VIEW_TYPE,
                    active: true,
                });
            }
        }
        
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    private setStatus(text: string) {
        if (this.statusBarEl) this.statusBarEl.setText(text);
    }

    async executeMerge(sources: TFile[], target: TFile) {
        if (!this.settings.geminiApiKey) {
            new Notice("Add your Gemini API key in Note Merger settings");
            return;
        }

        this.setStatus("⏳ Merging...");
        new Notice(`Starting merge of ${sources.length} file(s) into ${target.basename}...`);

        try {
            const targetContent = await this.app.vault.read(target);
            const sourceContents = await Promise.all(sources.map(f => this.app.vault.read(f)));
            const combinedSourceA = sourceContents.join("\n\n---\n\n");

            const result = await mergeWithRetry(
                new KeyManager(this.settings, async () => await this.saveSettings()),
                this.settings.mergerModel,
                this.settings.judgeModel,
                this.settings.mergerPrompt,
                this.settings.judgePrompt,
                [combinedSourceA, targetContent],
                this.settings.maxRetries,
                this.settings.enableJudge,
                (attempt, maxAttempts, issues) => {
                    this.setStatus(`⏳ Merge attempt ${attempt}/${maxAttempts}...`);
                    if (attempt === 1) {
                        new Notice(`Merging... (attempt ${attempt}/${maxAttempts})`);
                    } else {
                        new Notice(`Retrying (attempt ${attempt}/${maxAttempts}) — fixing ${issues.length} issues...`);
                    }
                }
            );

            this.setStatus("");
            if (result.attempts > 1) new Notice(`Merge completed after ${result.attempts} attempts.`);

            new MergeReviewModal(
                this.app, this, [...sources, target],
                combinedSourceA, targetContent,
                result.mergedOutput, result.suggestedName, result.judgeFeedback
            ).open();

        } catch (e) {
            this.setStatus("");
            new Notice(this.classifyError((e as Error).message || String(e)), 8000);
        }
    }

    private classifyError(msg: string): string {
        const m = msg.toLowerCase();
        if (msg.includes("429") || m.includes("quota") || m.includes("rate"))
            return "⚠️ API rate limit hit. Wait a minute and try again, or check your Gemini quota.";
        if (msg.includes("403") || m.includes("permission") || m.includes("api key"))
            return "⚠️ Invalid API key or permission denied. Check your key in Note Merger settings.";
        if (msg.includes("404") || m.includes("not found"))
            return "⚠️ Model not found. Check the model name in Note Merger settings.";
        if (m.includes("network") || m.includes("fetch") || m.includes("econnrefused"))
            return "⚠️ Network error. Check your internet connection and try again.";
        return `Merge failed: ${msg}. Source files unchanged.`;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        
        // Migrate single key to multi-key format if necessary
        if (this.settings.geminiApiKey && !this.settings.geminiApiKeys) {
            this.settings.geminiApiKeys = this.settings.geminiApiKey;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
