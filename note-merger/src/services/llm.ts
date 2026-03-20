import { PluginSettings } from "../config/types";

export async function executeChatCompletion(
    settings: PluginSettings,
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
    if (settings.provider === "gemini") {
        const sendGeminiRequest = async (useSystemInstruction: boolean) => {
            const body: any = { contents: [{ parts: [{ text: useSystemInstruction ? userPrompt : systemPrompt + "\n\n" + userPrompt }] }] };
            if (useSystemInstruction) body.systemInstruction = { parts: [{ text: systemPrompt }] };

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const errMsg = errJson.error?.message || res.statusText;
                if (res.status === 400 && errMsg.toLowerCase().includes("developer instruction")) {
                    return "GAMEMODEL_FALLBACK"; // Signal to retry without systemInstruction
                }
                throw new Error(`[${res.status} HTTP Error] ${errMsg}`);
            }
            const data = await res.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        };

        const firstTry = await sendGeminiRequest(true);
        if (firstTry === "GAMEMODEL_FALLBACK") {
            console.warn(`Model ${model} doesn't support system instructions. Prepending to prompt.`);
            return await sendGeminiRequest(false);
        }
        return firstTry;
    } else {
        // OpenAI Compatible endpoints (Zhipu/GLM, OpenAI, Custom)
        let baseUrl = settings.customBaseUrl;
        if (settings.provider === "zhipu") baseUrl = "https://open.bigmodel.cn/api/paas/v4";
        else if (settings.provider === "openai") baseUrl = "https://api.openai.com/v1";
        else if (settings.provider === "groq") baseUrl = "https://api.groq.com/openai/v1";
        else if (settings.provider === "together") baseUrl = "https://api.together.xyz/v1";
        else if (settings.provider === "deepseek") baseUrl = "https://api.deepseek.com/v1";
        else if (settings.provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1";
        else if (settings.provider === "minimax") baseUrl = "https://api.minimaxi.com/v1";
        else if (settings.provider === "kimi") baseUrl = "https://api.moonshot.cn/v1";
        else if (settings.provider === "qwen") baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
        else if (settings.provider === "mimo") baseUrl = "https://api.xiaomimimo.com/v1";
        else if (settings.provider === "webai") {
            baseUrl = settings.customBaseUrl || "http://127.0.0.1:6969/v1";
            if (!baseUrl.endsWith("/v1") && !baseUrl.endsWith("/v1/")) baseUrl = baseUrl.replace(/\/+$/, "") + "/v1";
        }

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
