import { Plugin, TFile, TFolder, Notice, MarkdownView, MarkdownFileInfo, Editor } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, TrainingRecord } from "./config";
import { CONTENT_MERGER_PROMPT } from "./prompts";
import { mergeWithRetry, KeyManager, appendToTrainingDataset } from "./services";
import { MasterFileSelectorModal, MergeWithModal, BatchLinkMergeModal, CopyContentModal } from "./modals";
import { NoteMergerSettingTab, MergeQueueView, MERGE_QUEUE_VIEW_TYPE } from "./ui";

export default class NoteMergerPlugin extends Plugin {
    settings!: PluginSettings;
    private statusBarEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        this.statusBarEl = this.addStatusBarItem();
        this.registerView(MERGE_QUEUE_VIEW_TYPE, leaf => new MergeQueueView(leaf, this));

        // Right-click single file
        this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
            if (file instanceof TFile && file.extension === "md") {
                menu.addItem(item => item.setTitle("Merge into current note").setIcon("git-merge")
                    .onClick(async () => {
                        const active = this.app.workspace.getActiveFile();
                        if (!active) { new Notice("Open a target note first"); return; }
                        if (active.path === file.path) { new Notice("Cannot merge a note into itself"); return; }
                        await this.executeMerge([file], active);
                    }));
            }
        }));

        // Right-click multi-file
        this.registerEvent(this.app.workspace.on("files-menu", (menu, files) => {
            const md = files.filter(f => f instanceof TFile && f.extension === "md") as TFile[];
            if (md.length >= 2) {
                menu.addItem(item => item.setTitle(`Merge ${md.length} selected files`).setIcon("git-merge")
                    .onClick(() => new MasterFileSelectorModal(this.app, md, async master => {
                        await this.executeMerge(md.filter(f => f.path !== master.path), master);
                    }).open()));
            }
        }));

        this.addCommand({ id: "merge-with", name: "Merge with...", checkCallback: (checking) => {
            if (!this.app.workspace.getActiveFile()) return false;
            if (!checking) new MergeWithModal(this.app, this).open();
            return true;
        }});

        this.addCommand({ id: "merge-linked-note", name: "Merge linked note under cursor",
            editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                const active = ctx.file;
                if (!active) { new Notice("No active file"); return; }
                const line = editor.getLine(editor.getCursor().line);
                const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
                let m, linked: string | null = null;
                while ((m = re.exec(line)) !== null) {
                    if (editor.getCursor().ch >= m.index && editor.getCursor().ch <= m.index + m[0].length) { linked = m[1]; break; }
                }
                if (!linked) { new Notice("Place cursor on a [[wiki-link]]"); return; }
                const file = this.app.metadataCache.getFirstLinkpathDest(linked, active.path);
                if (!file) { new Notice(`Not found: "${linked}"`); return; }
                if (file.path === active.path) { new Notice("Cannot merge into itself"); return; }
                await this.executeMerge([file], active);
            }
        });

        this.addCommand({ id: "batch-merge-links", name: "Batch merge from links", checkCallback: (checking) => {
            if (!this.app.workspace.getActiveFile()) return false;
            if (!checking) new BatchLinkMergeModal(this.app, this).open();
            return true;
        }});

        this.addCommand({ id: "open-merge-queue", name: "Open merge queue panel", callback: () => this.activateMergeQueue() });
        this.addSettingTab(new NoteMergerSettingTab(this.app, this));

        // -- Utilities --
        const toggleStatus = async () => {
            const active = this.app.workspace.getActiveFile();
            if (!active || active.extension !== "md") { new Notice("No active markdown note."); return; }
            await this.app.fileManager.processFrontMatter(active, (fm) => {
                if (fm.Status && String(fm.Status).toLowerCase() === "read") fm.Status = "Unread";
                else fm.Status = "Read";
            });
            new Notice(`Status: Read/Unread toggled for ${active.basename}`);
        };

        this.addCommand({
            id: 'toggle-note-status',
            name: 'Toggle Status: Read/Unread',
            callback: toggleStatus
        });

        this.addRibbonIcon('check-circle', 'Toggle Read/Unread Status', toggleStatus);

        // Copy content from folder
        this.addCommand({
            id: 'copy-folder-content',
            name: 'Copy content from current folder',
            callback: () => {
                const active = this.app.workspace.getActiveFile();
                if (!active || !active.parent) { new Notice("Open a note inside a folder first."); return; }
                const folderFiles = active.parent.children.filter(c => c instanceof TFile && c.extension === "md") as TFile[];
                folderFiles.sort((a, b) => a.basename.localeCompare(b.basename));
                new CopyContentModal(this.app, folderFiles, active.parent.name).open();
            }
        });

        // Right-click folder context menu
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem(item => {
                        item.setTitle("Copy content from files")
                            .setIcon("copy")
                            .onClick(() => {
                                const folderFiles = file.children.filter(c => c instanceof TFile && c.extension === "md") as TFile[];
                                folderFiles.sort((a, b) => a.basename.localeCompare(b.basename));
                                new CopyContentModal(this.app, folderFiles, file.name).open();
                            });
                    });
                }
            })
        );

        // Smart Copy Command (Reads Highlights OR Base View Items)
        this.addCommand({
            id: 'copy-content-from-selection',
            name: 'Copy content from highlighted text or active view',
            callback: async () => {
                let text = "";
                const editor = this.app.workspace.activeEditor?.editor;
                if (editor) text = editor.getSelection();
                if (!text) text = window.getSelection()?.toString() || "";
                
                const names = new Set<string>();
                
                // 1. If user highlighted text, extract links from it
                if (text.trim().length > 0) {
                    const wikiRe = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
                    let m;
                    while ((m = wikiRe.exec(text)) !== null) names.add(m[1].trim());
                    if (names.size === 0) {
                        for (const line of text.split("\n")) {
                            const c = line.replace(/^[\s\-\*\\>•\d\.]+/, "").replace(/\.md$/i, "").trim();
                            if (c.length > 0) names.add(c);
                        }
                    }
                } 
                // 2. Fallback: Parse the active view DOM (e.g. Base view list items)
                else {
                    const view = this.app.workspace.activeLeaf?.view;
                    if (!view) { new Notice("Highlight some text or focus a list view first!"); return; }
                    
                    const elems = view.containerEl.querySelectorAll('a.internal-link, [data-path], .bases-entry-title, .title, .name');
                    elems.forEach(el => {
                        const path = el.getAttribute('data-path') || el.getAttribute('href') || el.textContent;
                        if (path) {
                            const clean = path.replace(/\.md$/i, "").replace(/^[\s\-\*\\>•\d\.]+/, "").trim();
                            if (clean) names.add(clean);
                        }
                    });
                }
                
                const resolvedFiles: TFile[] = [];
                for (const name of names) {
                    const file = this.app.metadataCache.getFirstLinkpathDest(name, "");
                    if (file && !resolvedFiles.some(f => f.path === file.path)) {
                        resolvedFiles.push(file);
                    }
                }
                
                if (resolvedFiles.length === 0) {
                    new Notice("No files could be resolved. Highlight text containing filenames and try again.");
                    return;
                }
                
                // Open our modal with the scraped files (maintaining strict DOM/Selection ordering!)
                const sourceTitle = ((this.app.workspace.activeLeaf?.view as any)?.title || "Extracted Links").replace(".base", "");
                new CopyContentModal(this.app, resolvedFiles, sourceTitle).open();
            }
        });
    }

    async activateMergeQueue() {
        const { workspace } = this.app;
        let leaf: any = workspace.getLeavesOfType(MERGE_QUEUE_VIEW_TYPE)[0];
        if (!leaf) {
            const sc = workspace.getLeavesOfType("smart-connections-view");
            const target = sc.length > 0 ? sc[0] : workspace.getRightLeaf(false);
            leaf = target ? workspace.createLeafBySplit(target, "horizontal") : workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: MERGE_QUEUE_VIEW_TYPE, active: true });
        }
        if (leaf) workspace.revealLeaf(leaf);
    }

    private setStatus(text: string) { if (this.statusBarEl) this.statusBarEl.setText(text); }

    async executeMerge(sources: TFile[], target: TFile): Promise<TFile[]> {
        if (!this.settings.geminiApiKeys) { new Notice("Add your API key in Note Merger settings"); return []; }
        this.setStatus("⏳ Merging...");
        new Notice(`Starting merge of ${sources.length} file(s) into ${target.basename}...`);
        try {
            const rawTargetContent = await this.app.vault.read(target);
            
            // Extract YAML from target note before stripping
            let extractedYaml = "";
            const yamlMatch = rawTargetContent.match(/^---\n([\s\S]*?)\n---/);
            if (yamlMatch) {
                extractedYaml = `---\n${yamlMatch[1]}\n---\n`;
            }

            const stripYaml = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

            const contents = await Promise.all(sources.map(async f => stripYaml(await this.app.vault.read(f))));
            const targetBody = stripYaml(rawTargetContent);
            const combined = contents.join("\n\n---\n\n");
            
            const km = new KeyManager(this.settings, async () => await this.saveSettings());
            const result = await mergeWithRetry(km, this.settings.mergerModel,
                this.settings.mergerPrompt, [combined, targetBody],
                (attempt: number, max: number, issues: string[]) => {
                    this.setStatus(`⏳ Attempt ${attempt}/${max}...`);
                    new Notice(attempt === 1 ? `Merging... (${attempt}/${max})` : `Retrying (${attempt}/${max}) — ${issues.length} issues`);
                },
                (msg: string) => {
                    this.setStatus(`⏳ ${msg}`);
                }
            );
            this.setStatus("");
            if (result.attempts > 1) new Notice(`Done after ${result.attempts} attempts.`);

            // Split mergedOutput into multiple files
            const rawOutput = result.mergedOutput.trim();
            // Regex to find all ===FILE: Title=== occurrences
            const fileBlocks = rawOutput.split(/^(===FILE:[ \t]*[^\n]+===)[ \t]*\n/m);
            
            let filesCreated: TFile[] = [];
            const folderPath = target.parent?.path;
            const basePath = folderPath ? folderPath + "/" : "";

            // The split creates an array like: [ "intro text...", "===FILE: A===", "content A", "===FILE: B===", "content B" ]
            for (let i = 1; i < fileBlocks.length; i += 2) {
                const header = fileBlocks[i];
                const content = fileBlocks[i+1] || "";
                
                const titleMatch = header.match(/^===FILE:[ \t]*([^\n=]+)===/);
                if (titleMatch && titleMatch[1]) {
                    // Sanitize filename
                    let fileName = titleMatch[1].trim().replace(/[\\/:*?"<>|]/g, "") + ".md";
                    let newContent = extractedYaml + content.trim() + "\n";
                    
                    let newFilePath = basePath + fileName;
                    
                    // Handle duplicates by adding a number
                    let counter = 1;
                    while (this.app.vault.getAbstractFileByPath(newFilePath)) {
                        newFilePath = basePath + titleMatch[1].trim().replace(/[\\/:*?"<>|]/g, "") + ` (${counter}).md`;
                        counter++;
                    }

                    const newFile = await this.app.vault.create(newFilePath, newContent);
                    filesCreated.push(newFile);
                }
            }

            if (filesCreated.length > 0) {
                new Notice(`Successfully created ${filesCreated.length} new note(s) from merge!`);
            } else {
                new Notice(`No ===FILE=== delimiters found. Could not split into distinct notes.`);
                // Fallback: Just save it to target if no files were detected.
                await this.app.vault.modify(target, extractedYaml + rawOutput + "\n");
                filesCreated.push(target);
            }

            // Generate Training Record
            const record: TrainingRecord = {
                messages: [
                    { role: "system", content: this.settings.mergerPrompt },
                    { role: "user", content: [combined, targetBody].filter(Boolean).join("\n\n=======================\n\n") },
                    { role: "assistant", content: result.mergedOutput }
                ],
                metadata: {
                    id: `merge_${new Date().toISOString().replace(/[:.]/g, "-")}`,
                    source_files: [...sources, target].map(f => f.name),
                    timestamp: new Date().toISOString(),
                    model_merger: this.settings.mergerModel,
                    attempts: result.attempts
                }
            };

            await appendToTrainingDataset(
                this.app, record,
                this.settings.trainingDataPath,
                this.settings.trainingDataPath.replace(".jsonl", "_stats.json")
            );

            if (this.settings.deleteSourceAfterMerge) {
                if (filesCreated.length > 0 && !filesCreated.includes(target)) {
                    // All new files created, safe to delete sources and the target "container" note
                    for (const f of sources) { await this.app.vault.delete(f); }
                    await this.app.vault.delete(target);
                    new Notice("Sources and target note deleted.");
                } else if (filesCreated.includes(target)) {
                    // Fallback happened, only delete sources
                    for (const f of sources) { await this.app.vault.delete(f); }
                    new Notice("Source notes deleted (target preserved).");
                }
            }

            return filesCreated;
        } catch (e) {
            this.setStatus("");
            const msg = (e as Error).message || String(e);
            console.error("Merge error:", msg); // Keep in console for debugging

            // Extract the actual Google API error message if present
            let displayMsg = msg;
            const match = msg.match(/\[([^\]]+)\]\s(.*)/);
            if (match && match[2]) displayMsg = match[2];

            if (msg.includes("429") || msg.includes("quota")) new Notice("⚠️ API rate limit. Wait or check quota.", 8000);
            else if (msg.includes("403") && !msg.includes("key")) new Notice("⚠️ 403 Forbidden. Check permissions.", 8000);
            else if (msg.toLowerCase().includes("api key not valid")) new Notice("⚠️ Invalid API key.", 8000);
            else if (msg.includes("404")) new Notice("⚠️ Model not found. Check settings.", 8000);
            else new Notice(`Merge failed: ${displayMsg}`, 10000);
            return [];
        }
    }

    async loadSettings() {
        const saved = await this.loadData() || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

        let needsSave = false;

        // Migrate legacy single API key
        if (this.settings.geminiApiKey && !this.settings.geminiApiKeys) {
            this.settings.geminiApiKeys = this.settings.geminiApiKey;
            needsSave = true;
        }

        // Remove stale metadata settings from old two-stage pipeline
        if ("metadataModel" in (saved as any) || "metadataPrompt" in (saved as any)) {
            delete (this.settings as any).metadataModel;
            delete (this.settings as any).metadataPrompt;
            needsSave = true;
        }

        // Reset merger prompt if it still contains YAML generation instructions
        if (this.settings.mergerPrompt && this.settings.mergerPrompt.includes("YAML FRONTMATTER")) {
            this.settings.mergerPrompt = CONTENT_MERGER_PROMPT;
            needsSave = true;
        }

        // Reset merger prompt if it uses the old multi-line bullet styling
        if (this.settings.mergerPrompt && this.settings.mergerPrompt.includes("Use ONLY standard bullet points (-) and sub-bullets")) {
            this.settings.mergerPrompt = CONTENT_MERGER_PROMPT;
            needsSave = true;
        }

        // Removed Judge Prompt reset check here

        if (needsSave) await this.saveSettings();
    }

    async saveSettings() { await this.saveData(this.settings); }
}
