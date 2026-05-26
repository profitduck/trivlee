import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

// Threshold for considering a generation stuck. The worst-case D8-10
// generation takes ~2 minutes (research + parallel validate+write).
// 5 minutes is well past any healthy run — past this, we assume the
// background worker died (Railway process restart, crashed thread, etc.)
// and surface failure so the user can retry instead of staring at a
// dead spinner forever.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Tiny polling endpoint for the generation-progress UI. Returns the real
 * server-side phase plus how long it's been since the last phase change.
 *
 * Self-healing: if generation_phase_at is older than STUCK_THRESHOLD_MS,
 * we mark the row as failed atomically and return failed to the client.
 * The atomic conditional UPDATE (WHERE generation_phase = $oldValue)
 * means a slow-but-alive worker still has the option to win the race —
 * it'll bump phase_at on its next setPhase() call.
 *
 * Response shapes:
 *   { phase: "researching"     , phaseAt: "...iso..." }                   active
 *   { phase: null              , phaseAt: "...iso..." }                   done
 *   { phase: "failed"          , phaseAt: "...iso...", error: "msg" }     failed
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await requireUser();

  const { rows } = await query<{
    challenger_id: string;
    generation_phase: string | null;
    generation_phase_at: string | null;
  }>(
    `SELECT challenger_id, generation_phase, generation_phase_at
       FROM challenges
      WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.challenger_id !== user.id) {
    // Only the challenger sees their own generation phase — joiners don't
    // need progress updates since they only land on /join/[token] after the
    // match is fully generated.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const phase = row.generation_phase;

  // Already failed — just relay it.
  if (phase && phase.startsWith("failed:")) {
    return NextResponse.json({
      phase: "failed",
      phaseAt: row.generation_phase_at,
      error: phase.slice("failed:".length),
    });
  }

  // Stuck check: a non-null, non-failed phase that hasn't been touched in
  // STUCK_THRESHOLD_MS means the background worker probably died (Railway
  // process restart kills in-flight `after()` tasks). Flip it to failed.
  if (phase && row.generation_phase_at) {
    const ageMs = Date.now() - new Date(row.generation_phase_at).getTime();
    if (ageMs > STUCK_THRESHOLD_MS) {
      const errorMsg =
        "Generation timed out. The server may have restarted mid-job — please try again.";
      // Atomic: only flip to failed if the phase is STILL the stale one.
      // If a slow worker has since written a new phase, we leave it alone.
      const updated = await query<{ id: string }>(
        `UPDATE challenges
           SET generation_phase = $2,
               generation_phase_at = now()
         WHERE id = $1
           AND generation_phase = $3
           AND generation_phase_at = $4
         RETURNING id`,
        [id, `failed:${errorMsg}`, phase, row.generation_phase_at]
      );
      if (updated.rows.length > 0) {
        console.warn(
          `[phase] auto-failed stuck match ${id} — phase '${phase}' last touched ${Math.round(ageMs / 1000)}s ago`
        );
        return NextResponse.json({
          phase: "failed",
          phaseAt: new Date().toISOString(),
          error: errorMsg,
        });
      }
      // Race lost — worker is alive and just wrote a new phase. Re-read.
      const { rows: refreshed } = await query<{
        generation_phase: string | null;
        generation_phase_at: string | null;
      }>(
        `SELECT generation_phase, generation_phase_at FROM challenges WHERE id = $1`,
        [id]
      );
      const r = refreshed[0];
      return NextResponse.json({
        phase: r?.generation_phase ?? null,
        phaseAt: r?.generation_phase_at ?? null,
      });
    }
  }

  return NextResponse.json({
    phase,
    phaseAt: row.generation_phase_at,
  });
}
