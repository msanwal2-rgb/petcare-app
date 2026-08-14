"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { getProviders } from "next-auth/react";
import { toast } from "sonner";
import type { User } from "@/types";
import { getUserById } from "@/lib/api/users";
import {
  loginAsDemo,
  loginWithGoogle,
  loginWithPassword,
  useAuthNavigate,
} from "@/lib/auth/session-client";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoRole } from "@/lib/auth/demo";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { BLUR_DATA_URL } from "@/lib/media/photos";


export default function LoginPage() {
  const navigateAfterAuth = useAuthNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [samples, setSamples] = useState<Partial<Record<DemoRole, User>>>({});
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const roles = Object.keys(DEMO_ACCOUNTS) as DemoRole[];
    Promise.all(roles.map((r) => getUserById(DEMO_ACCOUNTS[r]))).then((users) => {
      setSamples(
        Object.fromEntries(
          roles.map((r, i) => [r, users[i]]).filter(([, u]) => u)
        ) as Partial<Record<DemoRole, User>>
      );
    });
    // Only show the Google button when the OAuth provider is configured.
    getProviders().then((p) => setGoogleEnabled(Boolean(p?.google)));
  }, []);

  async function demoLogin(user: User) {
    setLoading(true);
    try {
      await loginAsDemo(user.email);
      toast.success(`Welcome back, ${user.name.split(" ")[0]}!`);
      navigateAfterAuth("/dashboard");
    } catch {
      toast.error("Demo login failed. Try re-seeding the database.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await loginWithPassword(email.trim(), password);
      toast.success(`Welcome back, ${user.name.split(" ")[0]}!`);
      navigateAfterAuth("/dashboard");
    } catch {
      toast.error("No account matches that email and password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Log in to manage your pets, bookings, and caretaker profile.
      </p>

      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        {googleEnabled && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={loginWithGoogle}
              disabled={loading}
            >
              Continue with Google
            </Button>
            <div className="my-5 flex items-center gap-3 text-xs text-charcoal/40">
              <span className="h-px flex-1 bg-mist" />
              or with email
              <span className="h-px flex-1 bg-mist" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" variant="cta" className="w-full" disabled={loading}>
            {loading ? "Logging in…" : "Log in"}
          </Button>
          <p className="text-right text-xs">
            <Link
              href="/forgot-password"
              className="text-charcoal/55 hover:text-ink hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-charcoal/40">
          <span className="h-px flex-1 bg-mist" />
          or try a demo account
          <span className="h-px flex-1 bg-mist" />
        </div>

        <div className="space-y-2">
          {(Object.keys(DEMO_ACCOUNTS) as DemoRole[]).map((role) => {
            const u = samples[role];
            return (
              <button
                key={role}
                onClick={() => u && demoLogin(u)}
                disabled={!u || loading}
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
        <p className="mt-3 text-center font-mono text-[10px] text-charcoal/40">
          demo password: {DEMO_PASSWORD}
        </p>
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
