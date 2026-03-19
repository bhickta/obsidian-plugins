import { GoogleGenerativeAI } from "@google/generative-ai";
import { JudgeFeedback } from "../config";
import { KeyManager } from "./key-manager";

export async function scoreMerge(
    keyManager: KeyManager, modelName: string, systemPrompt: string,
    sourceA: string, sourceB: string, mergedOutput: string
): Promise<JudgeFeedback> {
    const prompt = `--- SOURCE A ---\n${sourceA}\n\n--- SOURCE B ---\n${sourceB}\n\n--- MERGED OUTPUT ---\n${mergedOutput}`;

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
                console.warn(`Judge key rate limited: ${apiKey.substring(0, 6)}***`);
                await keyManager.markKeyFailed(apiKey);
            } else { throw e; }
        }
    }

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
