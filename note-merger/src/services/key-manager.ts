import { PluginSettings } from "../config/types";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export class KeyManager {
    public settings: PluginSettings;
    private saveSettings: () => Promise<void>;

    constructor(settings: PluginSettings, saveSettings: () => Promise<void>) {
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    async getValidKey(): Promise<string> {
        let rawKeys = this.settings.providerApiKeys[this.settings.provider];
        if (!rawKeys && this.settings.provider === "gemini") rawKeys = this.settings.apiKeys || this.settings.geminiApiKeys;
        const keys = (rawKeys || "").split("\n").map(k => k.trim()).filter(k => k.length > 0);

        if (keys.length === 0) {
            throw new Error("No API keys configured. Add keys in Note Merger settings.");
        }

        const now = Date.now();
        for (const key of keys) {
            const failedAt = this.settings.failedKeys[key];
            if (!failedAt || (now - failedAt) >= COOLDOWN_MS) {
                if (failedAt) {
                    delete this.settings.failedKeys[key];
                    await this.saveSettings();
                }
                return key;
            }
        }
        throw new Error("All API keys are on cooldown. Try again later or add more keys.");
    }

    async markKeyFailed(key: string): Promise<void> {
        this.settings.failedKeys[key] = Date.now();
        await this.saveSettings();
    }
}
