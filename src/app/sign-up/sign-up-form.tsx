"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction, type SignUpFormState } from "./actions";

export function SignUpForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<SignUpFormState | null, FormData>(
    signUpAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          placeholder="alice"
          autoComplete="username"
          autoFocus
          required
          pattern="^[a-z0-9_]{3,20}$"
        />
        <p className="text-xs text-muted-foreground">
          3-20 characters. Lowercase letters, digits, or underscores.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="display_name">
          Display name <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="display_name"
          name="display_name"
          placeholder="Alice Doe"
          autoComplete="name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">
          Email <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="alice@example.com"
          autoComplete="email"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account…
          </>
        ) : (
          "Create account"
        )}
      </Button>
    </form>
  );
}
