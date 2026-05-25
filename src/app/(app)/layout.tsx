import { requireUser } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <>
      <SiteHeader user={user} />
      <div className="flex-1 bg-confetti">
        <div className="mx-auto max-w-6xl px-6 py-10 sm:py-14">{children}</div>
      </div>
    </>
  );
}
