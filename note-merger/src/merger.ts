import { GoogleGenerativeAI } from "@google/generative-ai";
import { scoreMerge } from "./judge";
import { JudgeFeedback } from "./training";
import { KeyManager } from "./keyManager";

export interface MergeResult {
    content: string;
    suggestedName: string;
}

export interface MergeWithRetryResult {
    mergedOutput: string;
    suggestedName: string;
    judgeFeedback: JudgeFeedback;
    attempts: number;
}

export async function mergeNotes(
    keyManager: KeyManager,
    modelName: string,
    systemPrompt: string,
    sources: string[],
    hint?: string
): Promise<MergeResult> {

    let prompt = "Please merge the following sources:\n\n";
    sources.forEach((source, index) => {
        prompt += `--- SOURCE ${index + 1} ---\n${source}\n\n`;
    });

    if (hint) {
        prompt += `--- PREVIOUS DRAFT HINT ---\nUse this as a starting point and fix issues:\n${hint}\n\n`;
    }

    let result: any;
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
                console.warn(`Key rate limited. Putting on 24-hour cooldown: ${apiKey.substring(0, 6)}***`);
                await keyManager.markKeyFailed(apiKey);
                // System automatically continues loop, grabs next valid key
            } else {
                throw e;
            }
        }
    }

    let text = result.response.text();

    // Clean up markdown code fences
    if (text.startsWith("```markdown\n")) {
        text = text.substring("```markdown\n".length);
        if (text.endsWith("\n```")) {
            text = text.substring(0, text.length - 4);
        }
    } else if (text.startsWith("```\n")) {
        text = text.substring("```\n".length);
        if (text.endsWith("\n```")) {
            text = text.substring(0, text.length - 4);
        }
    }

    // Parse out the SUGGESTED_FILENAME line
    let suggestedName = "Merged Note";
    const lines = text.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    if (lastLine.startsWith("SUGGESTED_FILENAME:")) {
        suggestedName = lastLine.replace("SUGGESTED_FILENAME:", "").trim();
        suggestedName = suggestedName.replace(/^["']|["']$/g, "").replace(/\.md$/i, "");
        suggestedName = suggestedName.replace(/[\\/:*?"<>|]/g, "");
        text = lines.slice(0, -1).join("\n");
    }

    return { content: text.trim(), suggestedName };
}

/**
 * Self-healing retry loop: merges, judges, and if FAIL, feeds the Judge's
 * specific complaints back into the Merger as a correction hint.
 * Returns when either PASS is achieved or maxRetries is exhausted.
 */
export async function mergeWithRetry(
    keyManager: KeyManager,
    mergerModel: string,
    judgeModel: string,
    mergerPrompt: string,
    judgePrompt: string,
    sources: string[],
    maxRetries: number,
    enableJudge: boolean,
    onProgress?: (attempt: number, maxAttempts: number, issues: string[]) => void
): Promise<MergeWithRetryResult> {
    let mergedOutput = "";
    let suggestedName = "Merged Note";
    let judgeFeedback: JudgeFeedback = {
        score: 1.0,
        missing_facts: [],
        pronoun_issues: [],
        structure_issues: [],
        verdict: "PASS"
    };
    let hint: string | undefined = undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (onProgress) {
            const issues = hint ? judgeFeedback.missing_facts : [];
            onProgress(attempt, maxRetries, issues);
        }

        // Run the merger
        const mergeResult = await mergeNotes(keyManager, mergerModel, mergerPrompt, sources, hint);
        mergedOutput = mergeResult.content;
        suggestedName = mergeResult.suggestedName;

        // If judge is disabled, auto-pass
        if (!enableJudge) {
            return { mergedOutput, suggestedName, judgeFeedback, attempts: attempt };
        }

        // Run the judge
        judgeFeedback = await scoreMerge(
            keyManager,
            judgeModel,
            judgePrompt,
            sources[0],
            sources.length > 1 ? sources[1] : "",
            mergedOutput
        );

        // If PASS, we're done
        if (judgeFeedback.verdict === "PASS") {
            return { mergedOutput, suggestedName, judgeFeedback, attempts: attempt };
        }

        // If FAIL and we have retries left, build a correction hint
        if (attempt < maxRetries) {
            const corrections: string[] = [];
            if (judgeFeedback.missing_facts.length > 0) {
                corrections.push(
                    `CRITICAL: The following facts are MISSING from your output and MUST be added:\n` +
                    judgeFeedback.missing_facts.map(f => `  - ${f}`).join("\n")
                );
            }
            if (judgeFeedback.pronoun_issues.length > 0) {
                corrections.push(
                    `FIX these unresolved pronouns:\n` +
                    judgeFeedback.pronoun_issues.map(p => `  - ${p}`).join("\n")
                );
            }
            if (judgeFeedback.structure_issues.length > 0) {
                corrections.push(
                    `FIX these structural issues:\n` +
                    judgeFeedback.structure_issues.map(s => `  - ${s}`).join("\n")
                );
            }

            hint = mergedOutput + "\n\n--- CORRECTIONS REQUIRED ---\n" + corrections.join("\n\n");
        }
    }

    // Exhausted all retries
    return { mergedOutput, suggestedName, judgeFeedback, attempts: maxRetries };
}
