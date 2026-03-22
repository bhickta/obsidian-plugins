import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings } from "./config";
import { CONTENT_MERGER_PROMPT } from "./prompts";
import { NoteMergerSettingTab, MergeQueueView, MERGE_QUEUE_VIEW_TYPE } from "./ui";
import { registerCommands } from "./commands";
import { registerEvents } from "./events";

export default class NoteMergerPlugin extends Plugin {
    settings!: PluginSettings;
    private statusBarEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        this.statusBarEl = this.addStatusBarItem();
        this.registerView(MERGE_QUEUE_VIEW_TYPE, leaf => new MergeQueueView(leaf, this));

        // Delegate command and event registration
        registerEvents(this);
        registerCommands(this);

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

    public setStatus(text: string) { 
        if (this.statusBarEl) this.statusBarEl.setText(text); 
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

        if (needsSave) await this.saveSettings();
    }

    async saveSettings() { 
        await this.saveData(this.settings); 
    }
}
