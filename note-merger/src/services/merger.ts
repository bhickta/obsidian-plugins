import { GoogleGenerativeAI } from "@google/generative-ai";
import { KeyManager } from "./key-manager";

export interface MergeResult {
    content: string;
    suggestedName: string;
}

async function callWithRetry(keyManager: KeyManager, modelName: string, systemPrompt: string, prompt: string): Promise<any> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const apiKey = await keyManager.getValidKey();
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
        try {
            return await model.generateContent(prompt);
        } catch (e: any) {
            const msg = e.message?.toLowerCase() || "";
            if (msg.includes("developer instruction is not enabled")) {
                console.warn(`Model ${modelName} doesn't support system instructions. Prepending to prompt.`);
                const fallbackModel = genAI.getGenerativeModel({ model: modelName });
                return await fallbackModel.generateContent(systemPrompt + "\n\n" + prompt);
            }
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
    keyManager: KeyManager, modelName: string, systemPrompt: string,
    sources: string[], hint?: string
): Promise<MergeResult> {
    let prompt = "Please merge the following sources:\n\n";
    sources.forEach((src, i) => { prompt += `--- SOURCE ${i + 1} ---\n${src}\n\n`; });
    if (hint) prompt += `--- PREVIOUS DRAFT HINT ---\nFix issues:\n${hint}\n\n`;

    const result = await callWithRetry(keyManager, modelName, systemPrompt, prompt);

    let text = result.response.text();
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
