import { GoogleGenerativeAI } from "@google/generative-ai";
import { JudgeFeedback } from "./training";
import { KeyManager } from "./keyManager";

export async function scoreMerge(
    keyManager: KeyManager,
    modelName: string,
    systemPrompt: string,
    sourceA: string,
    sourceB: string,
    mergedOutput: string
): Promise<JudgeFeedback> {
    let result: any;
    const prompt = `--- SOURCE A ---\n${sourceA}\n\n--- SOURCE B ---\n${sourceB}\n\n--- MERGED OUTPUT ---\n${mergedOutput}`;
    while (true) {
        const apiKey = await keyManager.getValidKey();
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt
        });

        try {
            result = await model.generateContent(prompt);
            break;
        } catch (e: any) {
             const msg = e.message?.toLowerCase() || "";
             if (msg.includes("429") || msg.includes("quota") || msg.includes("rate")) {
                 console.warn(`Key rate limited in Judge. Putting on cooldown: ${apiKey.substring(0, 6)}***`);
                 await keyManager.markKeyFailed(apiKey);
             } else {
                 throw e;
             }
        }
    }

    try {
        let text = result.response.text().trim();

        if (text.startsWith("\`\`\`json")) {
            text = text.substring(7);
        } else if (text.startsWith("\`\`\`")) {
            text = text.substring(3);
        }
        if (text.endsWith("\`\`\`")) {
            text = text.substring(0, text.length - 3);
        }

        const parsed = JSON.parse(text);
        return {
            score: typeof parsed.score === "number" ? parsed.score : 0.5,
            missing_facts: Array.isArray(parsed.missing_facts) ? parsed.missing_facts : [],
            pronoun_issues: Array.isArray(parsed.pronoun_issues) ? parsed.pronoun_issues : [],
            structure_issues: Array.isArray(parsed.structure_issues) ? parsed.structure_issues : [],
            verdict: parsed.verdict === "PASS" ? "PASS" : "FAIL"
        };
    } catch (e) {
        console.error("Judge parsing error:", e);
        return {
            score: 0.5,
            missing_facts: ["Judge JSON Parsing Error"],
            pronoun_issues: [],
            structure_issues: [],
            verdict: "FAIL"
        };
    }
}
