import { PluginSettings } from "./settings";

export class KeyManager {
    settings: PluginSettings;
    saveSettings: () => Promise<void>;

    constructor(settings: PluginSettings, saveSettings: () => Promise<void>) {
        this.settings = settings;
        this.saveSettings = saveSettings;
    }

    async getValidKey(): Promise<string> {
        const keys = this.settings.geminiApiKeys
            .split('\n')
            .map(k => k.trim())
            .filter(k => k.length > 0);

        if (keys.length === 0) {
            throw new Error("No Gemini API keys provided. Please add them in the settings.");
        }

        const now = Date.now();
        const cooldownMs = 24 * 60 * 60 * 1000;
        let changed = false;

        // Unlock expired keys
        for (const lockedKey of Object.keys(this.settings.failedKeys)) {
            if (now - this.settings.failedKeys[lockedKey] > cooldownMs) {
                delete this.settings.failedKeys[lockedKey];
                changed = true;
            }
        }

        if (changed) {
            await this.saveSettings();
        }

        // Return first valid key
        for (const key of keys) {
            if (!this.settings.failedKeys[key]) {
                return key;
            }
        }

        throw new Error("All provided API keys are currently exhausted (24-hour timeout). Please add more keys or wait.");
    }

    async markKeyFailed(key: string) {
        this.settings.failedKeys[key] = Date.now();
        await this.saveSettings();
    }
}
