import { executeChatCompletion } from "./llm";
import { KeyManager } from "./key-manager";
import { getFrontMatterInfo } from "obsidian";

export interface MergeResult {
    content: string;
    suggestedName: string;
}

async function callWithRetry(keyManager: KeyManager, modelName: string, systemPrompt: string, prompt: string): Promise<string> {
    const maxAttempts = keyManager.settings.maxRetries || 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const apiKey = await keyManager.getValidKey();
        try {
            return await executeChatCompletion(keyManager.settings, apiKey, modelName, systemPrompt, prompt);
        } catch (e: any) {
            const msg = e.message?.toLowerCase() || "";
            if (msg.includes("429") || msg.includes("quota") || msg.includes("rate") || msg.includes("503")) {
                console.warn(`[Attempt ${attempt}/${maxAttempts}] Rate limited: ${apiKey.substring(0, 6)}***`);
                await keyManager.markKeyFailed(apiKey);
                if (attempt < maxAttempts) {
                    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000); // 2s, 4s, 8s, 16s, 30s
                    console.log(`Waiting ${delay / 1000}s before retry...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            } else { throw e; }
        }
    }
    throw new Error("All API keys exhausted or rate limited. Try again later.");
}

export async function mergeNotes(
    keyManager: KeyManager, mergerModel: string,
    systemPrompt: string,
    sources: string[], hint?: string,
    onProgressUpdate?: (msg: string) => void
): Promise<MergeResult> {
    let prompt = "Please merge the following sources:\n\n";
    sources.forEach((src, i) => { 
        const info = getFrontMatterInfo(src);
        const contentOnly = info.exists ? src.substring(info.contentStart) : src;
        prompt += `--- SOURCE ${i + 1} ---\n${contentOnly.trim()}\n\n`; 
    });
    if (hint) prompt += `--- PREVIOUS DRAFT HINT ---\nFix issues:\n${hint}\n\n`;

    if (onProgressUpdate) onProgressUpdate("Merging content...");
    const result = await callWithRetry(keyManager, mergerModel, systemPrompt, prompt);

    let text = result.trim();
    if (text.startsWith("```markdown\n")) { text = text.substring(12); if (text.endsWith("\n```")) text = text.slice(0, -4); }
    else if (text.startsWith("```\n")) { text = text.substring(4); if (text.endsWith("\n```")) text = text.slice(0, -4); }

    let suggestedName = "Merged Note";
    const lines = text.trim().split("\n");
    const last = lines[lines.length - 1];
    if (last.startsWith("SUGGESTED_FILENAME:")) {
        suggestedName = last.replace("SUGGESTED_FILENAME:", "").trim()
            .replace(/^["']|["']$/g, "").replace(/\.md$/i, "").replace(/[\\/:*?"<>|]/g, "");
        text = lines.slice(0, -1).join("\n");
    }

    return { content: text.trim(), suggestedName };
}
