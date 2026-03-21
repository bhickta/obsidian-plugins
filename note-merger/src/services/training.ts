import { App, TFile } from "obsidian";
import { TrainingRecord, TrainingStats } from "../config";

export async function appendToTrainingDataset(
    app: App, record: TrainingRecord, datasetPath: string, statsPath: string
) {
    const folder = datasetPath.substring(0, datasetPath.lastIndexOf("/"));
    if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);

    const line = JSON.stringify(record) + "\n";
    const file = app.vault.getAbstractFileByPath(datasetPath);
    if (file instanceof TFile) await app.vault.append(file, line);
    else await app.vault.create(datasetPath, line);

    await updateStats(app, record, statsPath);
}

export async function logRejection(app: App, record: TrainingRecord, statsPath: string) {
    const folder = statsPath.substring(0, statsPath.lastIndexOf("/"));
    if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    await updateStats(app, record, statsPath, true);
}

async function updateStats(app: App, record: TrainingRecord, path: string, rejected = false) {
    let stats: TrainingStats = {
        total_merges: 0, auto_approved: 0, human_edited: 0,
        rejected: 0
    };
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
        try { stats = JSON.parse(await app.vault.read(file)); } catch { /* fresh */ }
    }

    stats.total_merges++;
    if (rejected) { stats.rejected++; }
    else {
        stats.auto_approved++;
    }

    const json = JSON.stringify(stats, null, 2);
    if (file instanceof TFile) await app.vault.modify(file, json);
    else await app.vault.create(path, json);
}
