"use client";

import { useState, useTransition } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { joinAction } from "./actions";

export function JoinButton({ token, disabled }: { token: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await joinAction(token);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        className="w-full gap-2"
        disabled={pending || disabled}
        onClick={onClick}
      >
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            Joining…
          </>
        ) : (
          <>
            <Play className="size-5" />
            Join the match
          </>
        )}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
