"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail } from "@/lib/api/account";
import { refreshSessionUser } from "@/lib/auth/session-client";
import { ButtonLink } from "@/components/ui/Button";

function VerifyInner() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against double-invoke in dev/strict mode
    ran.current = true;
    if (!token) {
      setState("error");
      return;
    }
    verifyEmail(token)
      .then(async () => {
        await refreshSessionUser();
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [token]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 text-center sm:px-6">
      {state === "loading" && (
        <p className="text-sm text-charcoal/60">Verifying your email…</p>
      )}
      {state === "ok" && (
        <>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-leash/15 text-2xl">
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-ink">Email verified</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            Thanks — your account is now verified.
          </p>
          <ButtonLink href="/dashboard" variant="cta" className="mt-6">
            Go to dashboard
          </ButtonLink>
        </>
      )}
      {state === "error" && (
        <>
          <h1 className="text-2xl font-semibold text-ink">Link invalid</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            This verification link is invalid or has expired. You can request a
            new one from your dashboard.
          </p>
          <p className="mt-6 text-sm">
            <Link href="/dashboard" className="font-medium text-leash hover:underline">
              Go to dashboard
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <VerifyInner />
    </Suspense>
  );
}
