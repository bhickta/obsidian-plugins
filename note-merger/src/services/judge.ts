import { GoogleGenerativeAI } from "@google/generative-ai";
import { JudgeFeedback } from "../config";
import { KeyManager } from "./key-manager";

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
            if (msg.includes("429") || msg.includes("quota") || msg.includes("rate")) {
                console.warn(`[Judge attempt ${attempt}/${maxAttempts}] Rate limited: ${apiKey.substring(0, 6)}***`);
                await keyManager.markKeyFailed(apiKey);
                if (attempt < maxAttempts) {
                    const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                    await new Promise(r => setTimeout(r, delay));
                }
            } else { throw e; }
        }
    }
    throw new Error("All API keys exhausted or rate limited. Try again later.");
}

export async function scoreMerge(
    keyManager: KeyManager, modelName: string, systemPrompt: string,
    sourceA: string, sourceB: string, mergedOutput: string
): Promise<JudgeFeedback> {
    const prompt = `--- SOURCE A ---\n${sourceA}\n\n--- SOURCE B ---\n${sourceB}\n\n--- MERGED OUTPUT ---\n${mergedOutput}`;
    const result = await callWithRetry(keyManager, modelName, systemPrompt, prompt);

    try {
        let text = result.response.text().trim();
        if (text.startsWith("\`\`\`json")) text = text.substring(7);
        else if (text.startsWith("\`\`\`")) text = text.substring(3);
        if (text.endsWith("\`\`\`")) text = text.slice(0, -3);

        const p = JSON.parse(text);
        return {
            score: typeof p.score === "number" ? p.score : 0.5,
            missing_facts: Array.isArray(p.missing_facts) ? p.missing_facts : [],
            pronoun_issues: Array.isArray(p.pronoun_issues) ? p.pronoun_issues : [],
            structure_issues: Array.isArray(p.structure_issues) ? p.structure_issues : [],
            verdict: p.verdict === "PASS" ? "PASS" : "FAIL"
        };
    } catch (e) {
        console.error("Judge parsing error:", e);
        return { score: 0.5, missing_facts: ["Judge Parse Error"], pronoun_issues: [], structure_issues: [], verdict: "FAIL" };
    }
}
