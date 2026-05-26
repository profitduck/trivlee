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
    // Optional pipeline stage breakdown (3-stage flow only)
    research_ms?: number;
    validate_ms?: number;
    write_ms?: number;
    facts_researched?: number;
    facts_validated?: number;
  };
}

// ─── 3-stage pipeline types ────────────────────────────────────────────────

/**
 * A standalone fact candidate emitted by the researcher. One sentence,
 * citeable, NOT in question form. The researcher's job is to cast a wide
 * net of these; the validator decides which ones survive.
 */
export interface FactCandidate {
  /** The claim itself — one declarative sentence. */
  claim: string;
  /** Specific reference: "S6E18 'The Switch'", "1989", "Wikipedia article", etc. */
  source: string;
  /** Researcher's estimate; the writer may use this to bucket by difficulty. */
  suggested_difficulty: number;
  /** Optional sub-topic tag for multi-topic matches. */
  sub_topic?: string;
}

/**
 * A fact that's gone through validation. Only `verified=true && confidence='high'`
 * makes it to the writer.
 */
export interface ValidatedFact extends FactCandidate {
  verified: boolean;
  confidence: "high" | "medium" | "low";
  /** Short reason if rejected; empty if verified. */
  notes: string;
}

/**
 * Researcher's full response — facts plus topic-level metadata. The topic
 * interpretation flows through to the writer and ultimately to the user.
 */
export interface ResearchResponse {
  topic_interpretation: string;
  topic_safe: boolean;
  rejection_reason: string | null;
  difficulty_delivered: number;
  knowledge_warning: string | null;
  facts: FactCandidate[];
  meta: {
    model: string;
    latency_ms: number;
  };
}
