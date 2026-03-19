import { GoogleGenerativeAI } from "@google/generative-ai";
import { KeyManager } from "./key-manager";

export interface MergeResult {
    content: string;
    suggestedName: string;
}

export async function mergeNotes(
    keyManager: KeyManager, modelName: string, systemPrompt: string,
    sources: string[], hint?: string
): Promise<MergeResult> {
    let prompt = "Please merge the following sources:\n\n";
    sources.forEach((src, i) => { prompt += `--- SOURCE ${i + 1} ---\n${src}\n\n`; });
    if (hint) prompt += `--- PREVIOUS DRAFT HINT ---\nFix issues:\n${hint}\n\n`;

    let result: any;
    while (true) {
        const apiKey = await keyManager.getValidKey();
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
        try {
            result = await model.generateContent(prompt);
            break;
        } catch (e: any) {
            const msg = e.message?.toLowerCase() || "";
            if (msg.includes("429") || msg.includes("quota") || msg.includes("rate")) {
                console.warn(`Key rate limited: ${apiKey.substring(0, 6)}***`);
                await keyManager.markKeyFailed(apiKey);
            } else { throw e; }
        }
    }

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
