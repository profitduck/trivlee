export type ChallengeFormat = "multiple_choice" | "free_text" | "mixed";
export type PerQuestionFormat = "multiple_choice" | "free_text";
export type QuestionType = "factual" | "quote" | "identification" | "numeric";

export interface GenerationRequest {
  topic: string;
  difficulty: number; // 1-10
  format: ChallengeFormat;
  count: number;
}

export interface GeneratedQuestion {
  question: string;
  correct_answer: string;
  answer_aliases: string[];
  distractors: string[];
  source_hint: string;
  type: QuestionType;
  per_question_format: PerQuestionFormat;
}

export interface GenerationResponse {
  topic_interpretation: string;
  topic_safe: boolean;
  rejection_reason: string | null;
  difficulty_delivered: number;
  knowledge_warning: string | null;
  questions: GeneratedQuestion[];
  meta: {
    generated_by: string; // 'mock' | 'claude-sonnet-4-6'
    latency_ms: number;
  };
}
