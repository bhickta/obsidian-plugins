import NoteMergerPlugin from "../main";
import { Notice, TFile, TFolder } from "obsidian";
import { MasterFileSelectorModal, CopyContentModal } from "../modals";
import { MergeExecutor } from "../services";

export function registerEvents(plugin: NoteMergerPlugin) {
    // -------------------------------------
    // File Menu (Single File & Folder)
    // -------------------------------------
    plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
        // Single File Merge Option
        if (file instanceof TFile && file.extension === "md") {
            menu.addItem(item => item.setTitle("Merge into current note").setIcon("git-merge")
                .onClick(async () => {
                    const active = plugin.app.workspace.getActiveFile();
                    if (!active) { new Notice("Open a target note first"); return; }
                    if (active.path === file.path) { new Notice("Cannot merge a note into itself"); return; }
                    
                    const executor = new MergeExecutor(
                        plugin.app, 
                        plugin.settings, 
                        async () => await plugin.saveSettings(), 
                        (msg) => plugin.setStatus(msg)
                    );
                    await executor.executeMerge([file], active);
                }));
        }
        
        // Folder Copy Content Option
        if (file instanceof TFolder) {
            menu.addItem(item => {
                item.setTitle("Copy content from files")
                    .setIcon("copy")
                    .onClick(() => {
                        const folderFiles = file.children.filter(c => c instanceof TFile && c.extension === "md") as TFile[];
                        folderFiles.sort((a, b) => a.basename.localeCompare(b.basename));
                        new CopyContentModal(plugin.app, folderFiles, file.name).open();
                    });
            });
        }
    }));

    // -------------------------------------
    // Files Menu (Multiple Files Selected)
    // -------------------------------------
    plugin.registerEvent(plugin.app.workspace.on("files-menu", (menu, files) => {
        const md = files.filter(f => f instanceof TFile && f.extension === "md") as TFile[];
        if (md.length >= 2) {
            menu.addItem(item => item.setTitle(`Merge ${md.length} selected files`).setIcon("git-merge")
                .onClick(() => new MasterFileSelectorModal(plugin.app, md, async master => {
                    const executor = new MergeExecutor(
                        plugin.app, 
                        plugin.settings, 
                        async () => await plugin.saveSettings(), 
                        (msg) => plugin.setStatus(msg)
                    );
                    await executor.executeMerge(md.filter(f => f.path !== master.path), master);
                }).open()));
        }
    }));
}
