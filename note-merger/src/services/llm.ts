import { GoogleGenerativeAI } from "@google/generative-ai";
import { PluginSettings } from "../config/types";

export async function executeChatCompletion(
    settings: PluginSettings,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
    if (settings.provider === "gemini") {
        const genAI = new GoogleGenerativeAI(apiKey);
        const m = genAI.getGenerativeModel({ model: model, systemInstruction: systemPrompt });
        try {
            const res = await m.generateContent(userPrompt);
            return res.response.text();
        } catch (e: any) {
            const msg = e.message?.toLowerCase() || "";
            if (msg.includes("developer instruction is not enabled")) {
                console.warn(`Model ${model} doesn't support system instructions. Prepending to prompt.`);
                const fallbackModel = genAI.getGenerativeModel({ model: model });
                const res = await fallbackModel.generateContent(systemPrompt + "\n\n" + userPrompt);
                return res.response.text();
            }
            throw e;
        }
    } else {
        // OpenAI Compatible endpoints (Zhipu/GLM, OpenAI, Custom)
        let baseUrl = settings.customBaseUrl;
        if (settings.provider === "zhipu") baseUrl = "https://open.bigmodel.cn/api/paas/v4";
        else if (settings.provider === "openai") baseUrl = "https://api.openai.com/v1";

        const url = baseUrl.endsWith("/") ? baseUrl + "chat/completions" : baseUrl + "/chat/completions";
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ]
            })
        });

        if (!res.ok) {
            let errText = await res.text();
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error?.message) errText = errJson.error.message;
            } catch {}
            throw new Error(`[${res.status} HTTP Error] ${errText}`);
        }

        const data = await res.json();
        return data.choices[0].message.content;
    }
}
