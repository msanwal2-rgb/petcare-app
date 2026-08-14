"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { useSession } from "@/lib/store/session";
import { listUsers } from "@/lib/api/users";
import { loginAsDemo } from "@/lib/auth/session-client";
import type { User } from "@/types";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { ChevronDownIcon, XIcon } from "./ui/icons";
import { cn } from "@/lib/utils";

/**
 * DEV-ONLY account switcher. Jump between seeded owner, caretaker, vet and ops
 * accounts to see every UI state without logging in and out.
 *
 * It renders nothing in production, and the endpoint behind it refuses to list
 * accounts there too — the listing exposes every user's email address, so both
 * ends of that are gated rather than just the button.
 */
export function DevAccountSwitcher() {
  const { currentUser, hasHydrated } = useSession();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (open && users.length === 0) listUsers().then(setUsers);
  }, [open, users.length]);

  if (process.env.NODE_ENV === "production") return null;
  if (!hasHydrated) return null;

  async function switchTo(u: User) {
    setSwitching(true);
    try {
      await loginAsDemo(u.email); // establishes a real session
      setOpen(false);
    } catch {
      toast.error("Couldn’t switch account.");
    } finally {
      setSwitching(false);
    }
  }

  const roleLabel = (u: User) =>
    u.roles.length === 2 ? "owner + caretaker" : u.roles[0];

  return (
    <div className="fixed bottom-4 left-4 z-50 print:hidden">
      {open && (
        <div className="mb-2 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-mist bg-white p-2 shadow-2xl shadow-ink/10">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-ink">Switch account</span>
            <button onClick={() => setOpen(false)} aria-label="Close">
              <XIcon width={16} height={16} className="text-charcoal/50" />
            </button>
          </div>
          <div className="space-y-0.5">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => switchTo(u)}
                disabled={switching}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-fog",
                  currentUser?.id === u.id && "bg-fog ring-1 ring-mist"
                )}
              >
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                  <Image
                    src={u.avatarUrl}
                    alt=""
                    fill
                    sizes="32px"
                    placeholder="blur"
                    blurDataURL={BLUR_DATA_URL}
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal">
                    {u.name}
                  </p>
                  <p className="truncate font-mono text-[10px] uppercase text-charcoal/50">
                    {roleLabel(u)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-marigold/50 bg-marigold/15 px-3 py-2 text-xs font-medium text-[#8a5a12] shadow-lg shadow-ink/5 backdrop-blur transition-colors hover:bg-marigold/25"
      >
        <span className="rounded bg-marigold px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-ink">
          Dev
        </span>
        {currentUser ? `Acting as ${currentUser.name.split(" ")[0]}` : "Pick a test account"}
        <ChevronDownIcon width={14} height={14} className={cn(open && "rotate-180")} />
      </button>
    </div>
  );
}
