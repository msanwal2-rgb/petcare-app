"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { getProviders } from "next-auth/react";
import { toast } from "sonner";
import type { PublicUser } from "@/types";
import { getUserById } from "@/lib/api/users";
import { getPublicConfig } from "@/lib/api/config";
import {
  loginAsDemo,
  loginWithGoogle,
  loginWithPassword,
  navigateAfterAuth,
} from "@/lib/auth/session-client";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoRole } from "@/lib/auth/demo";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { BLUR_DATA_URL } from "@/lib/media/photos";

/**
 * What Auth.js sends back on `?error=`. Two of these are ours, thrown from the
 * `signIn` callback; the rest are the provider's own. Spelling them out matters
 * because the default is a bare code in the URL and a page that looks like
 * nothing happened.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  AccountExists:
    "An account with that email already exists. Sign in with your password, then link Google from your account settings.",
  EmailUnverified:
    "Google hasn't verified that email address, so we can't use it to sign you in.",
  RateLimited: "Too many sign-in attempts. Try again in a few minutes.",
  OAuthAccountNotLinked:
    "That Google account isn't linked to a Leash account yet.",
  OAuthSignin: "We couldn't start the Google sign-in. Please try again.",
  OAuthCallback: "Google sign-in didn't complete. Please try again.",
  Configuration: "Sign-in is misconfigured. Please contact support.",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [samples, setSamples] = useState<Partial<Record<DemoRole, PublicUser>>>({});
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [demoVisible, setDemoVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  // Read once on mount rather than during render: reading location while
  // rendering is the ref-during-render rule React 19 enforces here.
  const [signInError] = useState(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("error");
    if (!code) return null;
    return SIGN_IN_ERRORS[code] ?? "We couldn't sign you in. Please try again.";
  });

  useEffect(() => {
    getPublicConfig()
      .then((config) => {
        setDemoVisible(config.demoLoginVisible);
        if (!config.demoLoginVisible) return;
        const roles = Object.keys(DEMO_ACCOUNTS) as DemoRole[];
        return Promise.all(
          roles.map((r) => getUserById(DEMO_ACCOUNTS[r].id)),
        ).then((users) => {
          setSamples(
            Object.fromEntries(
              roles.map((r, i) => [r, users[i]]).filter(([, u]) => u),
            ) as Partial<Record<DemoRole, PublicUser>>,
          );
        });
      })
      .catch(() => setDemoVisible(false));
    // Only show the Google button when the OAuth provider is configured.
    getProviders().then((p) => setGoogleEnabled(Boolean(p?.google)));
  }, []);

  async function demoLogin(role: DemoRole, name: string) {
    setLoading(true);
    try {
      await loginAsDemo(DEMO_ACCOUNTS[role].email);
      toast.success(`Welcome back, ${name.split(" ")[0]}!`);
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

      {signInError && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-charcoal"
        >
          {signInError}
        </p>
      )}

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
          <Button
            type="submit"
            variant="cta"
            className="w-full"
            disabled={loading}
          >
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

        {demoVisible && (
          <>
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
                    onClick={() => u && demoLogin(role, u.name)}
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
          </>
        )}
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
