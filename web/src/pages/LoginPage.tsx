import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import type { PublicUser } from "@/types";
import { getUserById } from "@/api/users";
import { getPublicConfig } from "@/api/config";
import {
  SIGN_IN_ERRORS,
  destinationAfterAuth,
  loginAsDemo,
  loginWithGoogle,
  loginWithPassword,
  safeInternalPath,
} from "@/auth/session";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoRole } from "@/auth/demo";
import { Field, Input } from "@/components/ui/Field";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/Avatar";

/**
 * The booking forms a guest may use instead of signing in (STATUS §3-G). When
 * someone was bounced here from one, the page offers to carry on as a guest:
 * back to the same form, with `guest=1`, which the route guard lets through.
 */
function guestTargetFor(callbackUrl: string | null): string | null {
  const path = safeInternalPath(callbackUrl);
  if (!path || !/^\/(booking\/new|vets\/book)(\?|$)/.test(path)) return null;
  return path + (path.includes("?") ? "&" : "?") + "guest=1";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [samples, setSamples] = useState<Partial<Record<DemoRole, PublicUser>>>({});
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [demoVisible, setDemoVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const guestTarget = guestTargetFor(searchParams.get("callbackUrl"));

  const errorCode = searchParams.get("error");
  const signInError = errorCode
    ? SIGN_IN_ERRORS[errorCode] ?? "We couldn't sign you in. Please try again."
    : null;

  useEffect(() => {
    getPublicConfig()
      .then((config) => {
        // One request answers both: whether to offer the demo accounts, and
        // whether the OAuth client is configured. The reference project asked
        // Auth.js `getProviders()` for the second, which does not exist here.
        setGoogleEnabled(config.googleEnabled);
        setDemoVisible(config.demoLoginVisible);
        if (!config.demoLoginVisible) return;

        const roles = Object.keys(DEMO_ACCOUNTS) as DemoRole[];
        return Promise.all(roles.map((r) => getUserById(DEMO_ACCOUNTS[r].id))).then(
          (users) => {
            setSamples(
              Object.fromEntries(
                roles.map((r, i) => [r, users[i]]).filter(([, u]) => u),
              ) as Partial<Record<DemoRole, PublicUser>>,
            );
          },
        );
      })
      .catch(() => setDemoVisible(false));
  }, []);

  /** Honours `?callbackUrl=`, so someone bounced off a guarded page lands back there. */
  function goOn() {
    navigate(destinationAfterAuth(location.search, "/dashboard"), { replace: true });
  }

  async function demoLogin(role: DemoRole, name: string) {
    setLoading(true);
    try {
      await loginAsDemo(DEMO_ACCOUNTS[role].email);
      toast.success(`Welcome back, ${name.split(" ")[0]}!`);
      goOn();
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
      goOn();
    } catch (error) {
      // The server says the same thing for a wrong password and an unknown
      // address, and says something different only when it is throttling. Its
      // message is shown as-is rather than replaced, so the throttle is
      // distinguishable to a real user without this page knowing which case
      // it is in.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "No account matches that email and password.",
      );
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
              onClick={() =>
                loginWithGoogle(
                  destinationAfterAuth(location.search, "/dashboard"),
                )
              }
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
              to="/forgot-password"
              className="text-charcoal/55 hover:text-ink hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
          <p className="text-right text-xs text-charcoal/45">
            Booked as a guest? Use “Forgot your password?” to set one.
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
                    <Avatar src={u?.avatarUrl ?? ""} size={36} />
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

      {guestTarget && (
        <div className="mt-4 rounded-2xl border border-mist bg-fog/60 p-5">
          <p className="text-sm font-semibold text-ink">No account? Book as a guest</p>
          <p className="mt-1 text-sm text-charcoal/65">
            Give us your details and your pet’s, and send the request. You can save them as an
            account at the same time.
          </p>
          <ButtonLink to={guestTarget} variant="outline" className="mt-3 w-full">
            Continue as guest
          </ButtonLink>
        </div>
      )}

      <p className="mt-5 text-center text-sm text-charcoal/60">
        New to Leash?{" "}
        <Link to="/signup" className="font-medium text-leash hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
