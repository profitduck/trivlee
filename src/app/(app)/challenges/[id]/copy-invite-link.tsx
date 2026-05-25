"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function CopyInviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/join/${token}`
    : `/join/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — fall back to selecting the text.
    }
  }

  return (
    <Card className="border-dashed">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Link2 className="size-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1 min-w-0">
            <p className="text-sm font-medium">Invite link</p>
            <code className="block text-xs bg-muted rounded-lg p-2.5 break-all">
              {url}
            </code>
            <p className="text-xs text-muted-foreground">
              Anyone with the link can join until the match closes.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={copy} className="gap-1.5 shrink-0">
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              "Copy"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
