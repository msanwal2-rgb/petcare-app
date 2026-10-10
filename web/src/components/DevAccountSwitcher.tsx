import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/store/session";
import { getUserById, listUsers } from "@/api/users";
import { loginAsDemo } from "@/auth/session";
import { DEMO_ACCOUNTS, type DemoRole } from "@/auth/demo";
import type { UserRole } from "@/types";
import { Avatar } from "./Avatar";
import { ChevronDownIcon, XIcon } from "./ui/icons";
import { cn } from "@/lib/utils";

/** What a row needs: who, how to sign in as them, and what they are. */
interface Account {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  roles: UserRole[];
}

/**
 * DEV-ONLY account switcher. Jump between seeded owner, caretaker, vet and ops
 * accounts to see every UI state without logging in and out.
 *
 * Off in every production build — `import.meta.env.DEV` is false there and
 * Vite drops the branch — and the endpoint behind it refuses to list accounts
 * outside Development too, because the listing exposes every user's email
 * address. Both ends are gated rather than just the button.
 *
 * `GET /users` also needs a session. Signed out, the switcher offers the three
 * seeded demo accounts instead — their public profiles, and the emails
 * `auth/demo.ts` already knows — so "Pick a test account" works from a cold
 * start, as the reference's did.
 */
export function DevAccountSwitcher() {
  const { currentUser, hasHydrated } = useSession();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<Account[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!open || users.length > 0) return;
    listUsers()
      .then(setUsers)
      .catch(async () => {
        const roles = Object.keys(DEMO_ACCOUNTS) as DemoRole[];
        const found = await Promise.all(roles.map((r) => getUserById(DEMO_ACCOUNTS[r].id)));
        setUsers(
          roles.flatMap((r, i) => {
            const u = found[i];
            return u ? [{ ...u, email: DEMO_ACCOUNTS[r].email }] : [];
          })
        );
      });
  }, [open, users.length]);

  if (!import.meta.env.DEV) return null;
  if (!hasHydrated) return null;

  async function switchTo(u: Account) {
    setSwitching(true);
    try {
      await loginAsDemo(u.email); // establishes a real session
      // Reload the page under the new session. Switching accounts changes what
      // every guarded route is allowed to render, and the in-memory session
      // and page data still hold the previous user's answers.
      window.location.assign(window.location.pathname);
    } catch {
      toast.error("Couldn’t switch account.");
      setSwitching(false);
    }
  }

  const roleLabel = (u: Account) =>
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
                <Avatar src={u.avatarUrl} size={32} />
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
