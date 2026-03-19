export interface JudgeFeedback {
    score: number;
    missing_facts: string[];
    pronoun_issues: string[];
    structure_issues: string[];
    verdict: "PASS" | "FAIL";
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface TrainingRecord {
    messages: ChatMessage[];
    metadata: {
        id: string;
        source_files: string[];
        judge_score: number;
        judge_feedback: JudgeFeedback | null;
        human_edited: boolean;
        conflict_types: string[];
        timestamp: string;
        model_merger: string;
        model_judge: string;
        attempts: number;
    }
}

export interface TrainingStats {
    total_merges: number;
    auto_approved: number;
    human_edited: number;
    rejected: number;
    conflict_type_counts: Record<string, number>;
    average_judge_score: number;
}
