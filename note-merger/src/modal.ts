import { App, Modal, Notice, TFile, Setting } from "obsidian";
import { JudgeFeedback, TrainingRecord, appendToTrainingDataset, logRejection } from "./training";
import NoteMergerPlugin from "./main";
import { mergeNotes } from "./merger";

export class MergeReviewModal extends Modal {
    plugin: NoteMergerPlugin;
    sourceAFiles: TFile[];
    sourceADoc: string;
    sourceBDoc: string;
    mergedDoc: string;
    suggestedName: string;
    judgeFeedback: JudgeFeedback;
    humanEdited: boolean = false;
    recordId: string;

    constructor(
        app: App,
        plugin: NoteMergerPlugin,
        sourceAFiles: TFile[],
        sourceADoc: string,
        sourceBDoc: string,
        mergedDoc: string,
        suggestedName: string,
        judgeFeedback: JudgeFeedback
    ) {
        super(app);
        this.plugin = plugin;
        this.sourceAFiles = sourceAFiles;
        this.sourceADoc = sourceADoc;
        this.sourceBDoc = sourceBDoc;
        this.mergedDoc = mergedDoc;
        this.suggestedName = suggestedName;
        this.judgeFeedback = judgeFeedback;
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0].replace(/-/g, "");
        const msStr = now.getMilliseconds().toString().padStart(3, "0");
        this.recordId = `merge_${dateStr}_${Math.floor(Math.random() * 1000)}${msStr}`;
    }

    onOpen() {
        this.containerEl.addClass("note-merger-modal");
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("note-merger-modal-content");

        // --- HEADER ---
        const headerEl = contentEl.createDiv("note-merger-header");
        const fNames = this.sourceAFiles.map(f => f.name).join(" + ");
        headerEl.createEl("h2", { text: `Merging: ${fNames}` });

        const scoreBadge = headerEl.createDiv("note-merger-score-badge");
        if (this.judgeFeedback.verdict === "PASS") {
            scoreBadge.addClass("pass");
        } else {
            scoreBadge.addClass("fail");
        }
        scoreBadge.setText(`Score: ${this.judgeFeedback.score.toFixed(2)} (${this.judgeFeedback.verdict})`);

        if (this.judgeFeedback.missing_facts.length > 0) {
            const missingContainer = headerEl.createDiv("note-merger-missing-facts");
            this.judgeFeedback.missing_facts.forEach(fact => {
                const pill = missingContainer.createDiv("note-merger-fact-pill");
                pill.setText(fact);
            });
        }

        // --- PANES ---
        const panesEl = contentEl.createDiv("note-merger-panes");

        const paneA = panesEl.createDiv("note-merger-pane");
        paneA.createDiv("note-merger-pane-header").setText("Source A");
        paneA.createDiv("note-merger-pane-content").setText(this.sourceADoc);

        const paneB = panesEl.createDiv("note-merger-pane");
        paneB.createDiv("note-merger-pane-header").setText("Source B / Target");
        paneB.createDiv("note-merger-pane-content").setText(this.sourceBDoc);

        const paneMerged = panesEl.createDiv("note-merger-pane");
        paneMerged.createDiv("note-merger-pane-header").setText("Merged Output");
        const textArea = paneMerged.createEl("textarea", { cls: ["note-merger-editor", "note-merger-pane-content"] });
        textArea.value = this.mergedDoc;
        
        textArea.addEventListener("input", () => {
            this.humanEdited = true;
            this.mergedDoc = textArea.value;
        });

        // --- JUDGE FEEDBACK SECTION ---
        const feedbackEl = contentEl.createDiv("note-merger-judge-feedback");
        feedbackEl.createEl("h4", { text: "Judge Feedback", cls: "mt-0" });
        
        this.renderIssueList(feedbackEl, "Missing Facts", this.judgeFeedback.missing_facts, textArea);
        this.renderIssueList(feedbackEl, "Pronoun Issues", this.judgeFeedback.pronoun_issues, textArea);
        this.renderIssueList(feedbackEl, "Structure Issues", this.judgeFeedback.structure_issues, textArea);

        // --- FOOTER BUTTONS ---
        const footerEl = contentEl.createDiv("note-merger-footer");

        const btnApprove = footerEl.createEl("button", { text: "Approve & Save" });
        btnApprove.addClass("mod-cta");
        btnApprove.onclick = () => this.handleApprove();

        const btnReRun = footerEl.createEl("button", { text: "Re-run Merge" });
        btnReRun.onclick = () => this.handleReRun();

        const btnReject = footerEl.createEl("button", { text: "Reject" });
        btnReject.onclick = () => this.handleReject();
    }

    renderIssueList(container: HTMLElement, title: string, items: string[], textArea: HTMLTextAreaElement) {
        if (!items || items.length === 0) return;
        
        const details = container.createEl("details");
        details.createEl("summary", { text: `${title} (${items.length})` });
        const list = details.createEl("ul", { cls: "note-merger-feedback-list" });
        
        items.forEach(item => {
            const li = list.createEl("li", { cls: "note-merger-issue-item" });
            li.createSpan({ text: item });
            
            const jumpBtn = li.createEl("button", { text: "Jump to", cls: "note-merger-jump-btn" });
            jumpBtn.onclick = () => {
                const idx = textArea.value.indexOf(item);
                if (idx !== -1) {
                    textArea.focus();
                    textArea.setSelectionRange(idx, idx + item.length);
                    const lines = textArea.value.substring(0, idx).split('\n').length;
                    textArea.scrollTop = (lines - 1) * 20; 
                }
            };
        });
    }

    async handleApprove() {
        try {
            const targetFile = this.sourceAFiles[this.sourceAFiles.length - 1]; 
            await this.app.vault.modify(targetFile, this.mergedDoc);

            // Log training record in OpenAI fine-tuning JSONL format
            const conflict_types = [];
            if (this.judgeFeedback.pronoun_issues.length > 0) conflict_types.push("pronoun_resolution");
            if (this.judgeFeedback.missing_facts.length > 0) conflict_types.push("unique_fact_preservation");
            if (this.judgeFeedback.structure_issues.length > 0) conflict_types.push("structural_nesting");
            if (conflict_types.length === 0) conflict_types.push("clean_merge");

            let promptStr = "Please merge the following sources:\n\n";
            let idx = 1;
            for (const f of [...this.sourceAFiles, targetFile]) {
                const text = f === targetFile ? this.sourceBDoc : this.sourceADoc; // Simplified
                // Not perfectly accurate reconstruction of the exact prompt, but good enough for training
                // Let's reconstruct it properly
            }
            // For a perfectly unified SFT instruction:
            let userContent = "Please merge the following sources:\n\n";
            userContent += `--- SOURCE 1 ---\n${this.sourceADoc}\n\n`;
            userContent += `--- SOURCE 2 ---\n${this.sourceBDoc}\n\n`;

            const record: TrainingRecord = {
                messages: [
                    { role: "system", content: this.plugin.settings.mergerPrompt },
                    { role: "user", content: userContent },
                    { role: "assistant", content: this.mergedDoc }
                ],
                metadata: {
                    id: this.recordId,
                    source_files: this.sourceAFiles.map(f => f.name),
                    judge_score: this.judgeFeedback.score,
                    judge_feedback: this.judgeFeedback,
                    human_edited: this.humanEdited,
                    conflict_types,
                    timestamp: new Date().toISOString(),
                    model_merger: this.plugin.settings.mergerModel,
                    model_judge: this.plugin.settings.judgeModel,
                    attempts: 1 // Ideally passed from merger, defaulted to 1 here for now
                }
            };

            const dsPath = this.plugin.settings.trainingDataPath;
            const statsPath = dsPath.substring(0, dsPath.lastIndexOf("/")) + "/stats.json";

            // STRICT QUALITY GATING for Fine-Tuning:
            // Only save to the dataset if the AI scored perfectly (1.0), OR if it failed but 
            // the human explicitly fixed it (serving as a perfect ground-truth correction).
            // This prevents "mediocre" output from polluting the training data.
            if (this.judgeFeedback.score === 1.0 || this.humanEdited) {
                await appendToTrainingDataset(this.app, record, dsPath, statsPath);
            }

            if (this.plugin.settings.deleteSourceAfterMerge) {
                for (let i = 0; i < this.sourceAFiles.length - 1; i++) {
                    await this.app.vault.delete(this.sourceAFiles[i]);
                }
            }

            this.close();

            // --- AUTO-RENAME ---
            if (this.plugin.settings.enableAutoRename) {
                new RenameModal(this.app, targetFile, this.suggestedName).open();
            } else {
                new Notice("Merge approved and saved.");
            }

        } catch (e) {
            console.error(e);
            new Notice("Failed to save merged note: " + (e as Error).message);
        }
    }

    async handleReRun() {
        const hint = this.mergedDoc;
        this.close();
        new Notice("Re-running merge with current output as hint...");
        
        try {
            const result = await mergeNotes(
                this.plugin.settings.geminiApiKey,
                this.plugin.settings.mergerModel,
                this.plugin.settings.mergerPrompt,
                [this.sourceADoc, this.sourceBDoc],
                hint
            );
            
            new MergeReviewModal(
                this.app,
                this.plugin,
                this.sourceAFiles,
                this.sourceADoc,
                this.sourceBDoc,
                result.content,
                result.suggestedName,
                this.judgeFeedback
            ).open();
            
        } catch (e) {
            console.error(e);
            new Notice("Merge failed: " + (e as Error).message);
        }
    }

    async handleReject() {
        let userContent = "Please merge the following sources:\n\n";
        userContent += `--- SOURCE 1 ---\n${this.sourceADoc}\n\n`;
        userContent += `--- SOURCE 2 ---\n${this.sourceBDoc}\n\n`;

        const record: TrainingRecord = {
            messages: [
                { role: "system", content: this.plugin.settings.mergerPrompt },
                { role: "user", content: userContent },
                { role: "assistant", content: this.mergedDoc }
            ],
            metadata: {
                id: this.recordId,
                source_files: this.sourceAFiles.map(f => f.name),
                judge_score: this.judgeFeedback.score,
                judge_feedback: this.judgeFeedback,
                human_edited: this.humanEdited,
                conflict_types: [],
                timestamp: new Date().toISOString(),
                model_merger: this.plugin.settings.mergerModel,
                model_judge: this.plugin.settings.judgeModel,
                attempts: 1
            }
        };

        const dsPath = this.plugin.settings.trainingDataPath;
        const statsPath = dsPath.substring(0, dsPath.lastIndexOf("/")) + "/stats.json";
        
        await logRejection(this.app, record, statsPath);
        new Notice("Merge rejected. No files were modified.");
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Small modal that shows an editable AI-suggested filename after approval.
 */
class RenameModal extends Modal {
    file: TFile;
    suggestedName: string;

    constructor(app: App, file: TFile, suggestedName: string) {
        super(app);
        this.file = file;
        this.suggestedName = suggestedName;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "Rename merged note" });
        contentEl.createEl("p", { text: "AI-suggested filename (edit if needed):", cls: "setting-item-description" });

        let newName = this.suggestedName;

        new Setting(contentEl)
            .setName("Filename")
            .addText(text => {
                text.setValue(this.suggestedName);
                text.inputEl.style.width = "100%";
                text.onChange(val => { newName = val; });
            });

        const footer = contentEl.createDiv({ cls: "note-merger-footer" });

        const btnRename = footer.createEl("button", { text: "Rename", cls: "mod-cta" });
        btnRename.onclick = async () => {
            if (!newName.trim()) {
                new Notice("Filename cannot be empty.");
                return;
            }
            try {
                const dir = this.file.parent?.path || "";
                const newPath = dir ? `${dir}/${newName}.md` : `${newName}.md`;
                await this.app.fileManager.renameFile(this.file, newPath);
                new Notice(`Renamed to: ${newName}.md`);
                this.close();
            } catch (e) {
                console.error(e);
                new Notice("Rename failed: " + (e as Error).message);
            }
        };

        const btnSkip = footer.createEl("button", { text: "Skip" });
        btnSkip.onclick = () => {
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
