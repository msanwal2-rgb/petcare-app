"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { User } from "@/types";
import { getUserById, listUsers } from "@/lib/api/users";
import { useSession } from "@/lib/store/session";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";

// Seed accounts wired up for one-tap demo login.
const DEMO = { owner: "u1", caretaker: "u10" };

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [samples, setSamples] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([getUserById(DEMO.owner), getUserById(DEMO.caretaker)]).then(
      ([o, c]) => {
        const map: Record<string, User> = {};
        if (o) map.owner = o;
        if (c) map.caretaker = c;
        setSamples(map);
      }
    );
  }, []);

  function loginAs(user: User) {
    setUser(user);
    toast.success(`Welcome back, ${user.name.split(" ")[0]}!`);
    router.push("/dashboard");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const users = await listUsers();
    const match = users.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase()
    );
    setLoading(false);
    if (match) loginAs(match);
    else
      toast.error("No account with that email. Try a demo account or sign up.");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Log in to manage your pets, bookings, and caretaker profile.
      </p>

      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password" htmlFor="password" hint="Mock — anything works">
            <Input id="password" type="password" placeholder="••••••••" />
          </Field>
          <Button type="submit" variant="cta" className="w-full" disabled={loading}>
            {loading ? "Logging in…" : "Log in"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-charcoal/40">
          <span className="h-px flex-1 bg-mist" />
          or try a demo account
          <span className="h-px flex-1 bg-mist" />
        </div>

        <div className="space-y-2">
          {(["owner", "caretaker"] as const).map((role) => {
            const u = samples[role];
            return (
              <button
                key={role}
                onClick={() => u && loginAs(u)}
                disabled={!u}
                className="flex w-full items-center gap-3 rounded-xl border border-mist bg-white p-2.5 text-left transition-colors hover:border-ink/30 disabled:opacity-50"
              >
                <span className="relative h-9 w-9 overflow-hidden rounded-full">
                  {u && (
                    <Image
                      src={u.avatarUrl}
                      alt=""
                      fill
                      sizes="36px"
                      placeholder="blur"
                      blurDataURL={BLUR_DATA_URL}
                      className="object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {u?.name ?? "…"}
                  </span>
                  <span className="block font-mono text-[10px] uppercase text-charcoal/50">
                    Demo {role}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-5 text-center text-sm text-charcoal/60">
        New to Leash?{" "}
        <Link href="/signup" className="font-medium text-leash hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
