import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { verifyEmail } from "@/api/auth";
import { refreshSessionUser } from "@/auth/session";
import { ButtonLink } from "@/components/ui/Button";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  // A missing token needs no request, so it isn't a state transition — it's the
  // starting state. Only the network result is set from the effect.
  const [state, setState] = useState<"loading" | "ok" | "error">(
    token ? "loading" : "error",
  );
  const ran = useRef(false);

  useEffect(() => {
    // The token is single-use, so a double-invoke in StrictMode would spend it
    // on the first render and report failure on the second.
    if (ran.current || !token) return;
    ran.current = true;

    verifyEmail(token)
      .then(async () => {
        // The badge in the header reads `verified` off the session user, so the
        // cached copy has to be refreshed or it stays stale until reload.
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
          <ButtonLink to="/dashboard" variant="cta" className="mt-6">
            Go to dashboard
          </ButtonLink>
        </>
      )}

      {state === "error" && (
        <>
          <h1 className="text-2xl font-semibold text-ink">Link invalid</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            This verification link is invalid or has expired. You can request a new
            one from your dashboard.
          </p>
          <p className="mt-6 text-sm">
            <Link to="/dashboard" className="font-medium text-leash hover:underline">
              Go to dashboard
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
