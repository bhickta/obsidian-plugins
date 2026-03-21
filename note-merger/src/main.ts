import { Plugin, TFile, Notice, MarkdownView, MarkdownFileInfo, Editor } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, TrainingRecord, JudgeFeedback } from "./config";
import { CONTENT_MERGER_PROMPT, DEFAULT_JUDGE_PROMPT } from "./prompts";
import { mergeWithRetry, KeyManager, appendToTrainingDataset } from "./services";
import { MasterFileSelectorModal, MergeWithModal, BatchLinkMergeModal } from "./modals";
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

    async executeMerge(sources: TFile[], target: TFile) {
        if (!this.settings.geminiApiKeys) { new Notice("Add your API key in Note Merger settings"); return; }
        this.setStatus("⏳ Merging...");
        new Notice(`Starting merge of ${sources.length} file(s) into ${target.basename}...`);
        try {
            const contents = await Promise.all(sources.map(f => this.app.vault.read(f)));
            const targetContent = await this.app.vault.read(target);
            const combined = contents.join("\n\n---\n\n");
            const km = new KeyManager(this.settings, async () => await this.saveSettings());
            const result = await mergeWithRetry(km, this.settings.mergerModel, this.settings.judgeModel,
                this.settings.mergerPrompt, this.settings.judgePrompt, [combined, targetContent],
                this.settings.maxRetries, this.settings.enableJudge,
                (attempt, max, issues) => {
                    this.setStatus(`⏳ Attempt ${attempt}/${max}...`);
                    new Notice(attempt === 1 ? `Merging... (${attempt}/${max})` : `Retrying (${attempt}/${max}) — ${issues.length} issues`);
                },
                (msg) => {
                    this.setStatus(`⏳ ${msg}`);
                }
            );
            this.setStatus("");
            if (result.attempts > 1) new Notice(`Done after ${result.attempts} attempts.`);

            const mergedText = result.mergedOutput.trim() + "\n";
            let newTargetContent = targetContent;
            if (targetContent.includes("===FILE:")) {
                newTargetContent = targetContent + "\n\n" + mergedText;
                newTargetContent = newTargetContent.replace(/^\s+/, "");
            } else {
                newTargetContent = mergedText;
            }

            // Save to active note
            await this.app.vault.modify(target, newTargetContent);
            new Notice(`Successfully merged and saved into ${target.basename}`);

            // Generate Training Record
            const conflicts: string[] = [];
            if (result.judgeFeedback.pronoun_issues.length) conflicts.push("pronoun_resolution");
            if (result.judgeFeedback.missing_facts.length) conflicts.push("unique_fact_preservation");

            const record: TrainingRecord = {
                messages: [
                    { role: "system", content: this.settings.mergerPrompt },
                    { role: "user", content: combined },
                    { role: "assistant", content: result.mergedOutput }
                ],
                metadata: {
                    id: `merge_${new Date().toISOString().replace(/[:.]/g, "-")}`,
                    source_files: [...sources, target].map(f => f.name),
                    judge_score: result.judgeFeedback.score,
                    judge_feedback: result.judgeFeedback,
                    human_edited: false,
                    conflict_types: conflicts.length ? conflicts : ["clean_merge"],
                    timestamp: new Date().toISOString(),
                    model_merger: this.settings.mergerModel,
                    model_judge: this.settings.judgeModel,
                    attempts: result.attempts
                }
            };

            await appendToTrainingDataset(
                this.app, record,
                this.settings.trainingDataPath,
                this.settings.trainingDataPath.replace(".jsonl", "_stats.json")
            );
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

        // Reset judge prompt if it still contains YAML-specific checks
        if (this.settings.judgePrompt && this.settings.judgePrompt.includes("missing_yaml_fields")) {
            this.settings.judgePrompt = DEFAULT_JUDGE_PROMPT;
            needsSave = true;
        }

        if (needsSave) await this.saveSettings();
    }

    async saveSettings() { await this.saveData(this.settings); }
}
