import Link from "next/link";
import { ArrowLeft, AlertTriangle, Sparkles, Database, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

interface AdminMatchRow {
  id: string;
  topic: string;
  topic_normalized: string;
  status: string;
  generation_phase: string | null;
  generation_phase_at: string | null;
  created_at: string;
  difficulty_requested: number;
  difficulty_delivered: number | null;
  num_questions: number;
  format: string;
  timer_mode: string;
  challenger_username: string;
  challenger_id: string;
  participant_count: number;
  question_count: number;
  generated_by: string | null;
  generation_meta: Record<string, unknown> | null;
  knowledge_warning: string | null;
}

async function getRecentMatches(limit: number): Promise<AdminMatchRow[]> {
  const { rows } = await query<AdminMatchRow & {
    participant_count: string;
    question_count: string;
  }>(
    `SELECT
       c.id, c.topic, c.topic_normalized,
       c.status::text AS status,
       c.generation_phase, c.generation_phase_at, c.created_at,
       c.difficulty_requested, c.difficulty_delivered,
       c.num_questions, c.format::text AS format,
       c.timer_mode::text AS timer_mode,
       c.knowledge_warning,
       u.username AS challenger_username, u.id AS challenger_id,
       (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) AS participant_count,
       (SELECT COUNT(*) FROM questions q
          JOIN question_sets qs ON qs.id = q.set_id
         WHERE qs.challenge_id = c.id) AS question_count,
       qs.generated_by, qs.generation_meta
     FROM challenges c
     JOIN users u ON u.id = c.challenger_id
     LEFT JOIN question_sets qs ON qs.challenge_id = c.id
     ORDER BY c.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    ...r,
    participant_count: Number(r.participant_count),
    question_count: Number(r.question_count),
  }));
}

export default async function AdminMatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  await requireAdmin();
  const { limit } = await searchParams;
  const limitN = Math.min(500, Math.max(10, parseInt(limit ?? "50", 10) || 50));
  const matches = await getRecentMatches(limitN);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/admin">
          <ArrowLeft className="size-4" />
          Back to admin
        </Link>
      </Button>

      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tighter">Matches</h1>
        <div className="flex gap-2 text-xs">
          {[20, 50, 100, 200].map((n) => (
            <Link
              key={n}
              href={`/admin/matches?limit=${n}`}
              className={`px-2.5 py-1 rounded-md ${
                n === limitN ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {n}
            </Link>
          ))}
        </div>
      </header>

      <div className="space-y-3">
        {matches.map((m) => (
          <MatchRow key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

function MatchRow({ m }: { m: AdminMatchRow }) {
  const phaseError = m.generation_phase?.startsWith("failed:")
    ? m.generation_phase.slice("failed:".length)
    : null;
  const phaseLive = m.generation_phase && !phaseError ? m.generation_phase : null;
  const cardClass = phaseError
    ? "border-destructive/40 bg-destructive/5"
    : phaseLive
      ? "border-primary/40 bg-primary/5"
      : "";
  return (
    <Card className={cardClass}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold">{m.topic}</h3>
            <Badge variant="outline" className="text-[10px]">
              D{m.difficulty_requested}
              {m.difficulty_delivered !== null && m.difficulty_delivered !== m.difficulty_requested && (
                <> → {m.difficulty_delivered}</>
              )}
            </Badge>
            <Badge variant="outline" className="text-[10px]">{m.format}</Badge>
            <Badge variant="outline" className="text-[10px]">timer: {m.timer_mode}</Badge>
            <Badge variant={m.status === "completed" ? "secondary" : "outline"} className="text-[10px]">
              {m.status}
            </Badge>
            {phaseError && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <AlertTriangle className="size-2.5" />
                failed
              </Badge>
            )}
            {phaseLive && (
              <Badge className="text-[10px] gap-1">
                <Sparkles className="size-2.5" />
                {phaseLive}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {new Date(m.created_at).toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span>by <span className="font-medium text-foreground">@{m.challenger_username}</span></span>
          <span>{m.num_questions} questions ({m.question_count} stored)</span>
          <span>{m.participant_count} player{m.participant_count === 1 ? "" : "s"}</span>
          {m.generated_by && <span className="font-mono text-[10px]">{m.generated_by}</span>}
        </div>

        {phaseError && (
          <div className="text-xs bg-destructive/10 border border-destructive/20 rounded-md p-2 text-destructive">
            <strong>Error:</strong> {phaseError}
          </div>
        )}

        {m.knowledge_warning && (
          <div className="text-xs bg-accent/30 border border-accent rounded-md p-2">
            <strong>Warning:</strong> {m.knowledge_warning}
          </div>
        )}

        {m.generation_meta && Object.keys(m.generation_meta).length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <Eye className="size-3" />
              Generation metadata
            </summary>
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-x-auto text-[11px] font-mono">
              {JSON.stringify(m.generation_meta, null, 2)}
            </pre>
          </details>
        )}

        <div className="flex gap-2 text-xs">
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1">
            <Link href={`/challenges/${m.id}`}>
              <Eye className="size-3" />
              Open match
            </Link>
          </Button>
          {m.question_count > 0 && (
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1">
              <Link href={`/admin/matches/${m.id}`}>
                <Database className="size-3" />
                View questions
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
