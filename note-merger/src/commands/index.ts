import NoteMergerPlugin from "../main";
import { Notice, MarkdownView, MarkdownFileInfo, Editor, TFile, TFolder } from "obsidian";
import { MergeWithModal, BatchLinkMergeModal, CopyContentModal } from "../modals";
import { MergeExecutor } from "../services";

export function registerCommands(plugin: NoteMergerPlugin) {
    // -------------------------------------
    // Merge Core Commands
    // -------------------------------------
    plugin.addCommand({ 
        id: "merge-with", 
        name: "Merge with...", 
        checkCallback: (checking) => {
            if (!plugin.app.workspace.getActiveFile()) return false;
            if (!checking) new MergeWithModal(plugin.app, plugin).open();
            return true;
        }
    });

    plugin.addCommand({ 
        id: "batch-merge-links", 
        name: "Batch merge from links", 
        checkCallback: (checking) => {
            if (!plugin.app.workspace.getActiveFile()) return false;
            if (!checking) new BatchLinkMergeModal(plugin.app, plugin).open();
            return true;
        }
    });

    plugin.addCommand({ 
        id: "open-merge-queue", 
        name: "Open merge queue panel", 
        callback: () => plugin.activateMergeQueue() 
    });

    plugin.addCommand({ 
        id: "merge-linked-note", 
        name: "Merge linked note under cursor",
        editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
            const active = ctx.file;
            if (!active) { new Notice("No active file"); return; }
            
            const line = editor.getLine(editor.getCursor().line);
            const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g;
            let m, linked: string | null = null;
            while ((m = re.exec(line)) !== null) {
                if (editor.getCursor().ch >= m.index && editor.getCursor().ch <= m.index + m[0].length) { 
                    linked = m[1]; break; 
                }
            }
            if (!linked) { new Notice("Place cursor on a [[wiki-link]]"); return; }
            
            const file = plugin.app.metadataCache.getFirstLinkpathDest(linked, active.path);
            if (!file) { new Notice(`Not found: "${linked}"`); return; }
            if (file.path === active.path) { new Notice("Cannot merge into itself"); return; }
            
            const executor = new MergeExecutor(
                plugin.app, 
                plugin.settings, 
                async () => await plugin.saveSettings(), 
                (msg) => plugin.setStatus(msg)
            );
            await executor.executeMerge([file], active);
        }
    });

    // -------------------------------------
    // Utilities & Smart Copy Commands
    // -------------------------------------
    const toggleStatus = async () => {
        const active = plugin.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") { new Notice("No active markdown note."); return; }
        await plugin.app.fileManager.processFrontMatter(active, (fm) => {
            if (fm.Status && String(fm.Status).toLowerCase() === "read") fm.Status = "Unread";
            else fm.Status = "Read";
        });
        new Notice(`Status: Read/Unread toggled for ${active.basename}`);
    };

    plugin.addCommand({ 
        id: 'toggle-note-status', 
        name: 'Toggle Status: Read/Unread', 
        callback: toggleStatus 
    });
    plugin.addRibbonIcon('check-circle', 'Toggle Read/Unread Status', toggleStatus);

    plugin.addCommand({
        id: 'copy-folder-content',
        name: 'Copy content from current folder',
        callback: () => {
            const active = plugin.app.workspace.getActiveFile();
            if (!active || !active.parent) { new Notice("Open a note inside a folder first."); return; }
            const folderFiles = active.parent.children.filter(c => c instanceof TFile && c.extension === "md") as TFile[];
            folderFiles.sort((a, b) => a.basename.localeCompare(b.basename));
            new CopyContentModal(plugin.app, folderFiles, active.parent.name).open();
        }
    });

    plugin.addCommand({
        id: 'copy-content-from-selection',
        name: 'Copy content from highlighted text or active view',
        callback: async () => {
            let text = "";
            const editor = plugin.app.workspace.activeEditor?.editor;
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
                const view = plugin.app.workspace.activeLeaf?.view;
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
                const file = plugin.app.metadataCache.getFirstLinkpathDest(name, "");
                if (file && !resolvedFiles.some(f => f.path === file.path)) {
                    resolvedFiles.push(file);
                }
            }
            
            if (resolvedFiles.length === 0) {
                new Notice("No files could be resolved. Highlight text containing filenames and try again.");
                return;
            }
            
            const sourceTitle = ((plugin.app.workspace.activeLeaf?.view as any)?.title || "Extracted Links").replace(".base", "");
            new CopyContentModal(plugin.app, resolvedFiles, sourceTitle).open();
        }
    });
}
