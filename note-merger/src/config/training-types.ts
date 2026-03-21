export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface TrainingRecord {
    messages: ChatMessage[];
    metadata: {
        id: string;
        source_files: string[];
        timestamp: string;
        model_merger: string;
        attempts: number;
    }
}

export interface TrainingStats {
    total_merges: number;
    auto_approved: number;
    human_edited: number;
    rejected: number;
}
