"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, ShieldOff, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteUserAction, toggleAdminAction } from "./actions";

/**
 * Row-level admin controls: promote/demote and delete. Both actions show
 * an inline confirmation step instead of opening a modal — it's terse and
 * the existing match-delete pattern works well here too.
 */
export function UserRowActions({
  userId,
  isAdmin,
  isSelf,
}: {
  userId: string;
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    // Admins shouldn't be able to break their own access from this screen.
    // The badge + "(you)" label gives the visual cue.
    return <span className="text-xs text-muted-foreground italic">(you)</span>;
  }

  if (confirmDelete) {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="text-xs font-medium text-destructive flex items-center gap-1">
          <AlertTriangle className="size-3.5" />
          Delete user + all their content?
        </span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await deleteUserAction(userId);
              if ("error" in res) {
                setError(res.error);
                setConfirmDelete(false);
              }
            });
          }}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Yes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirmDelete(false)}
        >
          No
        </Button>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await toggleAdminAction(userId, !isAdmin);
            if ("error" in res) setError(res.error);
          });
        }}
        className="gap-1.5"
        title={isAdmin ? "Demote from admin" : "Promote to admin"}
      >
        {isAdmin ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
        {isAdmin ? "Demote" : "Make admin"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setConfirmDelete(true)}
        className="gap-1.5 text-destructive hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
