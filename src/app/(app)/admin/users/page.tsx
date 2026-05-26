import Link from "next/link";
import { ArrowLeft, ShieldCheck, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { UserRowActions } from "./user-row-actions";

interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
  match_count: number;
  attempt_count: number;
}

async function getAllUsers(): Promise<AdminUserRow[]> {
  const { rows } = await query<AdminUserRow & { match_count: string; attempt_count: string }>(
    `SELECT
       u.id, u.username, u.email::text AS email, u.display_name,
       u.created_at, u.is_admin,
       (SELECT COUNT(*) FROM challenges c WHERE c.challenger_id = u.id) AS match_count,
       (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id)         AS attempt_count
     FROM users u
     ORDER BY u.is_admin DESC, u.created_at ASC`
  );
  return rows.map((r) => ({
    ...r,
    match_count: Number(r.match_count),
    attempt_count: Number(r.attempt_count),
  }));
}

export default async function AdminUsersPage() {
  const me = await requireAdmin();
  const users = await getAllUsers();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/admin">
          <ArrowLeft className="size-4" />
          Back to admin
        </Link>
      </Button>

      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-3xl font-extrabold tracking-tighter">Users</h1>
        <span className="text-sm text-muted-foreground tabular-nums">{users.length} total</span>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left p-4 font-semibold">User</th>
                <th className="text-left p-4 font-semibold hidden sm:table-cell">Email</th>
                <th className="text-right p-4 font-semibold hidden md:table-cell">Matches</th>
                <th className="text-right p-4 font-semibold hidden md:table-cell">Attempts</th>
                <th className="text-right p-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className="text-sm">
                  <td className="p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{u.display_name ?? u.username}</span>
                      <span className="text-xs text-muted-foreground">@{u.username}</span>
                      {u.is_admin && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <ShieldCheck className="size-3" />
                          admin
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="p-4 text-muted-foreground hidden sm:table-cell">
                    {u.email ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <Mail className="size-3" />
                        {u.email}
                      </span>
                    ) : (
                      <span className="text-xs italic">—</span>
                    )}
                  </td>
                  <td className="p-4 text-right tabular-nums hidden md:table-cell">{u.match_count}</td>
                  <td className="p-4 text-right tabular-nums hidden md:table-cell">{u.attempt_count}</td>
                  <td className="p-4 text-right">
                    <UserRowActions userId={u.id} isAdmin={u.is_admin} isSelf={u.id === me.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Deleting a user cascades to all their matches, attempts, ratings, and reports. Use with care.
      </p>
    </div>
  );
}
