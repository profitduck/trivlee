import Link from "next/link";
import { Swords, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { quickSwitchAction } from "./actions";
import { SignInForm } from "./sign-in-form";

async function getSeededUsers() {
  const { rows } = await query<{ id: string; username: string; display_name: string | null }>(
    `SELECT id, username, display_name FROM users ORDER BY created_at LIMIT 10`
  );
  return rows;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  // Already signed in — go where they were headed.
  const existing = await getCurrentUser();
  if (existing) redirect(next);

  // Dev-only quick-switch buttons. Hidden in production for safety since
  // anyone could click "Alice" and be signed in as her.
  const showQuickSwitch = process.env.NODE_ENV !== "production";
  const users = showQuickSwitch ? await getSeededUsers() : [];

  return (
    <main className="flex-1 bg-confetti">
      <div className="mx-auto max-w-md px-6 py-16 sm:py-24">
        <Link href="/" className="inline-flex items-center gap-2 mb-12">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Swords className="size-5" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">
            Trivlee
          </span>
        </Link>

        <Card className="border-2 shadow-lg">
          <CardHeader>
            <CardTitle className="font-display text-3xl">Welcome back</CardTitle>
            <CardDescription>
              {next !== "/dashboard"
                ? "Sign in to continue to your invite."
                : "Sign in with your username to start playing."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SignInForm next={next} />

            <p className="text-sm text-center text-muted-foreground">
              No account yet?{" "}
              <Link
                href={`/sign-up${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
                className="font-medium text-primary underline underline-offset-4"
              >
                Create one
              </Link>
            </p>

            {users.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
                    Quick switch (dev)
                  </p>
                  <div className="grid gap-2">
                    {users.map((u) => (
                      <form key={u.id} action={quickSwitchAction.bind(null, u.id, next)}>
                        <Button
                          type="submit"
                          variant="outline"
                          className="w-full justify-start gap-3 h-auto py-3"
                        >
                          <UserCircle2 className="size-5 text-muted-foreground" />
                          <span className="text-left">
                            <span className="font-medium">{u.display_name ?? u.username}</span>
                            <span className="block text-xs text-muted-foreground">@{u.username}</span>
                          </span>
                        </Button>
                      </form>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
