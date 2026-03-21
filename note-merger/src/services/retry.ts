import { JudgeFeedback } from "../config";
import { mergeNotes } from "./merger";
import { scoreMerge } from "./judge";
import { KeyManager } from "./key-manager";

export interface MergeWithRetryResult {
    mergedOutput: string;
    suggestedName: string;
    judgeFeedback: JudgeFeedback;
    attempts: number;
}

export async function mergeWithRetry(
    keyManager: KeyManager, mergerModel: string, judgeModel: string,
    mergerPrompt: string, judgePrompt: string, sources: string[],
    maxRetries: number, enableJudge: boolean,
    onProgress?: (attempt: number, max: number, issues: string[]) => void,
    onIntermediateProgress?: (msg: string) => void
): Promise<MergeWithRetryResult> {
    let mergedOutput = "", suggestedName = "Merged Note";
    let judgeFeedback: JudgeFeedback = {
        score: 1.0, missing_facts: [], pronoun_issues: [], structure_issues: [], verdict: "PASS"
    };
    let hint: string | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (onProgress) onProgress(attempt, maxRetries, hint ? judgeFeedback.missing_facts : []);

        const r = await mergeNotes(keyManager, mergerModel, mergerPrompt, sources, hint, onIntermediateProgress);
        mergedOutput = r.content;
        suggestedName = r.suggestedName;

        if (!enableJudge) return { mergedOutput, suggestedName, judgeFeedback, attempts: attempt };

        judgeFeedback = await scoreMerge(
            keyManager, judgeModel, judgePrompt,
            sources[0], sources.length > 1 ? sources[1] : "", mergedOutput
        );
        if (judgeFeedback.verdict === "PASS") return { mergedOutput, suggestedName, judgeFeedback, attempts: attempt };

        const issues = [
            ...judgeFeedback.missing_facts.map(f => `Missing: ${f}`),
            ...judgeFeedback.pronoun_issues.map(p => `Pronoun: ${p}`),
            ...judgeFeedback.structure_issues.map(s => `Structure: ${s}`)
        ];
        hint = mergedOutput + "\n\n--- JUDGE FEEDBACK ---\n" + issues.join("\n");
    }

    return { mergedOutput, suggestedName, judgeFeedback, attempts: maxRetries };
}
