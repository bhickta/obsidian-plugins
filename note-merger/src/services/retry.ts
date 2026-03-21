import { mergeNotes } from "./merger";
import { KeyManager } from "./key-manager";

export interface MergeWithRetryResult {
    mergedOutput: string;
    suggestedName: string;
    attempts: number;
}

export async function mergeWithRetry(
    keyManager: KeyManager, mergerModel: string,
    mergerPrompt: string, sources: string[],
    onProgress?: (attempt: number, max: number, issues: string[]) => void,
    onIntermediateProgress?: (msg: string) => void
): Promise<MergeWithRetryResult> {

    if (onProgress) onProgress(1, 1, []);
    const r = await mergeNotes(keyManager, mergerModel, mergerPrompt, sources, undefined, onIntermediateProgress);
    
    return { mergedOutput: r.content, suggestedName: r.suggestedName, attempts: 1 };
}
