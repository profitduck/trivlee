import Link from "next/link";
import { Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { signUpAction } from "./actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  // Already signed in — skip the form.
  const existing = await getCurrentUser();
  if (existing) redirect(next);

  return (
    <main className="flex-1 bg-confetti">
      <div className="mx-auto max-w-md px-6 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-2 mb-12">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Swords className="size-5" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">
            Trivia Duel
          </span>
        </Link>

        <Card className="border-2 shadow-lg">
          <CardHeader>
            <CardTitle className="font-display text-3xl">Create an account</CardTitle>
            <CardDescription>
              {next !== "/dashboard"
                ? "Pick a username to accept your invite."
                : "Pick a username and you’re in."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={signUpAction} className="space-y-4">
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

              <Button type="submit" className="w-full" size="lg">
                Create account
              </Button>
            </form>

            <p className="mt-6 text-sm text-center text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={`/sign-in${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
                className="font-medium text-primary underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
