"use client";

import { useState, useTransition } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteMatchAction } from "./actions";

/**
 * Two-step delete: first click reveals an inline confirmation row with
 * "Yes, delete" + "Cancel". Second click fires the server action. The
 * action redirects to /dashboard on success, so we don't need a success
 * state — the page is gone.
 *
 * Used in both the GenerationProgress failed card (for stuck matches)
 * and the regular match detail page actions row.
 */
export function DeleteMatchButton({
  challengeId,
  variant = "outline",
}: {
  challengeId: string;
  variant?: "default" | "outline" | "destructive" | "ghost";
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (confirming) {
    return (
      <div className="inline-flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-destructive flex items-center gap-1.5">
          <AlertTriangle className="size-4" />
          Delete this match?
        </span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await deleteMatchAction(challengeId);
              // deleteMatchAction redirects on success; we only get a return
              // value when it failed (e.g. not the host).
              if (result?.error) {
                setError(result.error);
                setConfirming(false);
              }
            });
          }}
          className="gap-1.5"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 className="size-3.5" />
              Yes, delete
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
        {error && <p className="text-xs text-destructive w-full">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={() => setConfirming(true)}
        className="gap-1.5"
      >
        <Trash2 className="size-4" />
        Delete match
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
