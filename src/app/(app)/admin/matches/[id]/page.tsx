import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { AdminBankActions } from "../admin-question-actions";

interface MatchHeader {
  id: string;
  topic: string;
  status: string;
  difficulty_requested: number;
  difficulty_delivered: number | null;
  challenger_username: string;
  num_questions: number;
}

interface QuestionRow {
  id: string;
  position: number;
  question_text: string;
  correct_answer: string;
  answer_aliases: string[];
  distractors: string[];
  source_hint: string | null;
  type: string;
  per_question_format: string;
  bank_question_id: string | null;
  bank_hidden: boolean | null;
  attempt_count: number;
  correct_attempt_count: number;
}

async function getMatchHeader(id: string): Promise<MatchHeader | null> {
  const { rows } = await query<MatchHeader>(
    `SELECT
       c.id, c.topic, c.status::text AS status,
       c.difficulty_requested, c.difficulty_delivered,
       c.num_questions,
       u.username AS challenger_username
     FROM challenges c
     JOIN users u ON u.id = c.challenger_id
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function getQuestions(challengeId: string): Promise<QuestionRow[]> {
  const { rows } = await query<QuestionRow & { attempt_count: string; correct_attempt_count: string }>(
    `SELECT
       q.id, q.position, q.question_text, q.correct_answer,
       q.answer_aliases, q.distractors, q.source_hint,
       q.type::text AS type, q.per_question_format::text AS per_question_format,
       q.bank_question_id,
       qb.hidden AS bank_hidden,
       (SELECT COUNT(*) FROM attempts a WHERE a.question_id = q.id) AS attempt_count,
       (SELECT COUNT(*) FROM attempts a WHERE a.question_id = q.id AND a.is_correct = true) AS correct_attempt_count
     FROM question_sets qs
     JOIN questions q ON q.set_id = qs.id
     LEFT JOIN question_bank qb ON qb.id = q.bank_question_id
     WHERE qs.challenge_id = $1
     ORDER BY q.position`,
    [challengeId]
  );
  return rows.map((r) => ({
    ...r,
    attempt_count: Number(r.attempt_count),
    correct_attempt_count: Number(r.correct_attempt_count),
  }));
}

export default async function AdminMatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [header, questions] = await Promise.all([getMatchHeader(id), getQuestions(id)]);
  if (!header) notFound();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/admin/matches">
          <ArrowLeft className="size-4" />
          Back to matches
        </Link>
      </Button>

      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">D{header.difficulty_requested}</Badge>
          <Badge variant="outline">@{header.challenger_username}</Badge>
          <Badge variant="secondary">{header.status}</Badge>
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tighter">{header.topic}</h1>
        <p className="text-sm text-muted-foreground">
          {questions.length} questions · requested {header.num_questions}
        </p>
      </header>

      <div className="space-y-3">
        {questions.map((q) => (
          <QuestionCard key={q.id} q={q} />
        ))}
      </div>
    </div>
  );
}

function QuestionCard({ q }: { q: QuestionRow }) {
  const correctPct =
    q.attempt_count > 0 ? Math.round((q.correct_attempt_count / q.attempt_count) * 100) : null;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">Q{q.position}</Badge>
            <Badge variant="outline" className="text-[10px]">{q.type}</Badge>
            <Badge variant="outline" className="text-[10px]">
              {q.per_question_format === "multiple_choice" ? "MC" : "free text"}
            </Badge>
            {q.bank_question_id && !q.bank_hidden && (
              <Badge variant="secondary" className="text-[10px]">in bank</Badge>
            )}
            {q.bank_question_id && q.bank_hidden && (
              <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                bank: hidden
              </Badge>
            )}
          </div>
          {correctPct !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {q.correct_attempt_count}/{q.attempt_count} correct ({correctPct}%)
            </span>
          )}
        </div>

        <p className="font-medium leading-snug">{q.question_text}</p>

        <div className="space-y-1.5">
          <div className="flex items-start gap-2 text-sm">
            <Check className="size-4 text-chart-5 shrink-0 mt-0.5" />
            <span className="font-medium">{q.correct_answer}</span>
            {q.answer_aliases.length > 0 && (
              <span className="text-xs text-muted-foreground">
                (aliases: {q.answer_aliases.join(", ")})
              </span>
            )}
          </div>
          {q.distractors.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <X className="size-4 shrink-0 mt-0.5 opacity-50" />
              <span>{d}</span>
            </div>
          ))}
        </div>

        {q.source_hint && (
          <p className="text-xs text-muted-foreground border-t pt-2">
            <span className="font-semibold">Source:</span> {q.source_hint}
          </p>
        )}

        {q.bank_question_id && (
          <div className="border-t pt-2 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono">
              bank id: {q.bank_question_id.slice(0, 8)}…
            </span>
            <AdminBankActions
              bankQuestionId={q.bank_question_id}
              currentlyHidden={q.bank_hidden ?? false}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
