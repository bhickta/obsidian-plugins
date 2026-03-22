import { App, Notice, TFile } from "obsidian";
import { PluginSettings, TrainingRecord } from "../config";
import { KeyManager } from "./key-manager";
import { mergeWithRetry } from "./retry";
import { appendToTrainingDataset } from "./training";

export class MergeExecutor {
    constructor(
        private app: App,
        private settings: PluginSettings,
        private saveSettingsCb: () => Promise<void>,
        private setStatusCb: (text: string) => void
    ) {}

    private setStatus(text: string) {
        this.setStatusCb(text);
    }

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
            
            const km = new KeyManager(this.settings, async () => await this.saveSettingsCb());
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
            const filesCreated = await this.splitAndSaveMergedOutput(rawOutput, target, extractedYaml);

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

    private async splitAndSaveMergedOutput(rawOutput: string, target: TFile, extractedYaml: string): Promise<TFile[]> {
        const fileBlocks = rawOutput.split(/^(===FILE:[ \t]*[^\n]+===)[ \t]*\n/m);
        
        let filesCreated: TFile[] = [];
        const folderPath = target.parent?.path;
        const basePath = folderPath ? folderPath + "/" : "";

        for (let i = 1; i < fileBlocks.length; i += 2) {
            const header = fileBlocks[i];
            const content = fileBlocks[i+1] || "";
            
            const titleMatch = header.match(/^===FILE:[ \t]*([^\n=]+)===/);
            if (titleMatch && titleMatch[1]) {
                let fileName = titleMatch[1].trim().replace(/[\\/:*?"<>|]/g, "") + ".md";
                let newContent = extractedYaml + content.trim() + "\n";
                
                let newFilePath = basePath + fileName;
                
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
            await this.app.vault.modify(target, extractedYaml + rawOutput + "\n");
            filesCreated.push(target);
        }
        return filesCreated;
    }
}
