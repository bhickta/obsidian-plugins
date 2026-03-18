import { App, TFile } from "obsidian";

export interface JudgeFeedback {
    score: number;
    missing_facts: string[];
    pronoun_issues: string[];
    structure_issues: string[];
    verdict: "PASS" | "FAIL";
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface TrainingRecord {
    messages: ChatMessage[];
    metadata: {
        id: string;
        source_files: string[];
        judge_score: number;
        judge_feedback: JudgeFeedback | null;
        human_edited: boolean;
        conflict_types: string[];
        timestamp: string;
        model_merger: string;
        model_judge: string;
        attempts: number;
    }
}

export interface TrainingStats {
    total_merges: number;
    auto_approved: number;
    human_edited: number;
    rejected: number;
    conflict_type_counts: Record<string, number>;
    average_judge_score: number;
}

export async function appendToTrainingDataset(
    app: App,
    record: TrainingRecord,
    datasetPath: string,
    statsPath: string
) {
    // Ensure _training folder exists
    const folderPath = datasetPath.substring(0, datasetPath.lastIndexOf("/"));
    if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
        await app.vault.createFolder(folderPath);
    }

    // Append to JSONL
    const jsonlLine = JSON.stringify(record) + "\n";
    let file = app.vault.getAbstractFileByPath(datasetPath);
    if (file instanceof TFile) {
        await app.vault.append(file, jsonlLine);
    } else {
        await app.vault.create(datasetPath, jsonlLine);
    }

    // Update stats
    await updateStats(app, record, statsPath);
}

export async function logRejection(
    app: App,
    record: TrainingRecord,
    statsPath: string
) {
    // Only updates stats for rejection
    const folderPath = statsPath.substring(0, statsPath.lastIndexOf("/"));
    if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
        await app.vault.createFolder(folderPath);
    }
    
    await updateStats(app, record, statsPath, true);
}

async function updateStats(app: App, record: TrainingRecord, statsPath: string, isRejection = false) {
    let stats: TrainingStats = {
        total_merges: 0,
        auto_approved: 0,
        human_edited: 0,
        rejected: 0,
        conflict_type_counts: {},
        average_judge_score: 0
    };

    let file = app.vault.getAbstractFileByPath(statsPath);
    if (file instanceof TFile) {
        const content = await app.vault.read(file);
        try {
            stats = JSON.parse(content);
        } catch (e) {
            console.error("Failed to parse stats file", e);
        }
    }

    stats.total_merges += 1;
    
    if (isRejection) {
        stats.rejected += 1;
    } else {
        if (record.metadata.human_edited) {
            stats.human_edited += 1;
        } else {
            stats.auto_approved += 1;
        }

        const oldTotalApproved = stats.auto_approved + stats.human_edited - 1; // Before this one
        const currentSum = stats.average_judge_score * oldTotalApproved;
        const newTotalApproved = stats.auto_approved + stats.human_edited;
        stats.average_judge_score = (currentSum + record.metadata.judge_score) / newTotalApproved;
        
        for (const ct of record.metadata.conflict_types) {
            stats.conflict_type_counts[ct] = (stats.conflict_type_counts[ct] || 0) + 1;
        }
    }

    const statsJson = JSON.stringify(stats, null, 2);
    if (file instanceof TFile) {
        await app.vault.modify(file, statsJson);
    } else {
        await app.vault.create(statsPath, statsJson);
    }
}
