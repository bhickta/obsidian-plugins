import { App, Modal, Notice, TFile, Setting } from "obsidian";
import { JudgeFeedback, TrainingRecord } from "../config";
import { appendToTrainingDataset, logRejection, mergeNotes, KeyManager } from "../services";
import type NoteMergerPlugin from "../main";
import { RenameModal } from "./rename";

export class MergeReviewModal extends Modal {
    plugin!: NoteMergerPlugin;  sourceAFiles!: TFile[];
    sourceADoc!: string;  sourceBDoc!: string;  mergedDoc!: string;
    suggestedName!: string;  judgeFeedback!: JudgeFeedback;
    humanEdited = false;  recordId: string;

    constructor(app: App, plugin: NoteMergerPlugin, files: TFile[],
        srcA: string, srcB: string, merged: string, name: string, feedback: JudgeFeedback) {
        super(app);
        Object.assign(this, { plugin, sourceAFiles: files, sourceADoc: srcA, sourceBDoc: srcB, mergedDoc: merged, suggestedName: name, judgeFeedback: feedback });
        const d = new Date();
        this.recordId = `merge_${d.toISOString().split("T")[0].replace(/-/g, "")}_${Math.floor(Math.random() * 1000)}`;
    }

    onOpen() {
        this.containerEl.addClass("note-merger-modal");
        const c = this.contentEl; c.empty(); c.addClass("note-merger-modal-content");
        const hdr = c.createDiv("note-merger-header");
        hdr.createEl("h2", { text: `Merging: ${this.sourceAFiles.map(f => f.name).join(" + ")}` });
        const badge = hdr.createDiv("note-merger-score-badge");
        badge.addClass(this.judgeFeedback.verdict === "PASS" ? "pass" : "fail");
        badge.setText(`Score: ${this.judgeFeedback.score.toFixed(2)} (${this.judgeFeedback.verdict})`);
        if (this.judgeFeedback.missing_facts.length) {
            const mc = hdr.createDiv("note-merger-missing-facts");
            this.judgeFeedback.missing_facts.forEach(f => mc.createDiv("note-merger-fact-pill").setText(f));
        }
        const panes = c.createDiv("note-merger-panes");
        this.addPane(panes, "Source A", this.sourceADoc);
        this.addPane(panes, "Source B / Target", this.sourceBDoc);
        const pM = panes.createDiv("note-merger-pane"); pM.createDiv("note-merger-pane-header").setText("Merged Output");
        const ta = pM.createEl("textarea", { cls: ["note-merger-editor", "note-merger-pane-content"] });
        ta.value = this.mergedDoc;
        ta.addEventListener("input", () => { this.humanEdited = true; this.mergedDoc = ta.value; });
        const fb = c.createDiv("note-merger-judge-feedback"); fb.createEl("h4", { text: "Judge Feedback" });
        for (const [t, items] of [["Missing Facts", this.judgeFeedback.missing_facts], ["Pronoun Issues", this.judgeFeedback.pronoun_issues], ["Structure Issues", this.judgeFeedback.structure_issues]] as const) {
            if (!items?.length) continue;
            const d = fb.createEl("details"); d.createEl("summary", { text: `${t} (${items.length})` });
            const ul = d.createEl("ul", { cls: "note-merger-feedback-list" });
            items.forEach(item => { const li = ul.createEl("li"); li.createSpan({ text: item }); });
        }
        const foot = c.createDiv("note-merger-footer");
        foot.createEl("button", { text: "Approve & Save", cls: "mod-cta" }).onclick = () => this.handleApprove();
        foot.createEl("button", { text: "Re-run Merge" }).onclick = () => this.handleReRun();
        foot.createEl("button", { text: "Reject" }).onclick = () => this.handleReject();
    }

    private addPane(parent: HTMLElement, title: string, text: string) {
        const p = parent.createDiv("note-merger-pane"); p.createDiv("note-merger-pane-header").setText(title); p.createDiv("note-merger-pane-content").setText(text);
    }

    private buildRecord(): TrainingRecord {
        const conflicts: string[] = [];
        if (this.judgeFeedback.pronoun_issues.length) conflicts.push("pronoun_resolution");
        if (this.judgeFeedback.missing_facts.length) conflicts.push("unique_fact_preservation");
        if (this.judgeFeedback.structure_issues.length) conflicts.push("structural_nesting");
        if (!conflicts.length) conflicts.push("clean_merge");
        return {
            messages: [
                { role: "system", content: this.plugin.settings.mergerPrompt },
                { role: "user", content: `Please merge:\n\n--- SOURCE 1 ---\n${this.sourceADoc}\n\n--- SOURCE 2 ---\n${this.sourceBDoc}\n\n` },
                { role: "assistant", content: this.mergedDoc }
            ],
            metadata: {
                id: this.recordId, source_files: this.sourceAFiles.map(f => f.name),
                judge_score: this.judgeFeedback.score, judge_feedback: this.judgeFeedback,
                human_edited: this.humanEdited, conflict_types: conflicts,
                timestamp: new Date().toISOString(),
                model_merger: this.plugin.settings.mergerModel, model_judge: this.plugin.settings.judgeModel, attempts: 1
            }
        };
    }

    async handleApprove() {
        try {
            const target = this.sourceAFiles[this.sourceAFiles.length - 1];
            const folderPath = target.parent?.path || "";
            
            // Parse for multiple files from the atomic prompt
            const fileBlocks = this.mergedDoc.split(/^===FILE:\s*(.+?)===$/m);
            
            if (fileBlocks.length > 2) {
                // LLM separated into multiple atomic files!
                for (let i = 1; i < fileBlocks.length; i += 2) {
                    const baseName = fileBlocks[i].trim().replace(/[\\/:*?"<>|]/g, "");
                    const content = fileBlocks[i+1].trim();
                    
                    if (i === 1) {
                        // First block overwrites the target file to preserve incoming links
                        await this.app.vault.modify(target, content);
                        const newPath = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
                        if (target.path !== newPath && !this.app.vault.getAbstractFileByPath(newPath)) {
                            await this.app.fileManager.renameFile(target, newPath);
                        }
                    } else {
                        // Subsequent blocks generate new files
                        let path = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
                        let suffix = 1;
                        while (this.app.vault.getAbstractFileByPath(path)) {
                            path = folderPath ? `${folderPath}/${baseName} ${suffix}.md` : `${baseName} ${suffix}.md`;
                            suffix++;
                        }
                        await this.app.vault.create(path, content);
                    }
                }
                new Notice("Multiple atomic files successfully created.");
            } else {
                // Fallback: standard 1-file merge
                await this.app.vault.modify(target, this.mergedDoc);
                if (this.plugin.settings.enableAutoRename) new RenameModal(this.app, target, this.suggestedName).open();
                else new Notice("Merge approved and saved.");
            }

            const ds = this.plugin.settings.trainingDataPath;
            const sp = ds.substring(0, ds.lastIndexOf("/")) + "/stats.json";
            if (this.judgeFeedback.score === 1.0 || this.humanEdited) await appendToTrainingDataset(this.app, this.buildRecord(), ds, sp);
            
            if (this.plugin.settings.deleteSourceAfterMerge) {
                for (let i = 0; i < this.sourceAFiles.length - 1; i++) await this.app.vault.delete(this.sourceAFiles[i]);
            }
            this.close();
        } catch (e) { console.error(e); new Notice("Failed: " + (e as Error).message); }
    }

    async handleReRun() {
        this.close(); new Notice("Re-running merge...");
        try {
            const km = new KeyManager(this.plugin.settings, async () => await this.plugin.saveSettings());
            const r = await mergeNotes(km, this.plugin.settings.mergerModel, this.plugin.settings.mergerPrompt, [this.sourceADoc, this.sourceBDoc], this.mergedDoc);
            new MergeReviewModal(this.app, this.plugin, this.sourceAFiles, this.sourceADoc, this.sourceBDoc, r.content, r.suggestedName, this.judgeFeedback).open();
        } catch (e) { console.error(e); new Notice("Merge failed: " + (e as Error).message); }
    }

    async handleReject() {
        const ds = this.plugin.settings.trainingDataPath;
        const sp = ds.substring(0, ds.lastIndexOf("/")) + "/stats.json";
        await logRejection(this.app, this.buildRecord(), sp);
        new Notice("Merge rejected. No files modified."); this.close();
    }

    onClose() { this.contentEl.empty(); }
}
