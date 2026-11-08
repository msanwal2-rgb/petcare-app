import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { completeAccountSetup } from "@/auth/session";
import { Field, Input } from "@/components/ui/Field";
import { Button, ButtonLink } from "@/components/ui/Button";

/**
 * A guest choosing their first password, from the link we emailed (STATUS
 * §3-G). The token is the credential, so the page is unguarded — like
 * /verify-email, it has to work on a phone that has never signed in.
 *
 * Success activates the account and signs it in; everything the guest booked
 * is already theirs, so the dashboard shows it straight away. A used or
 * expired link offers a new one through forgot-password, which sends a guest
 * the set-password link rather than a reset.
 */
export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don’t match.");
      return;
    }
    if (!token) {
      setExpired(true);
      return;
    }

    setLoading(true);
    try {
      const user = await completeAccountSetup(token, password);
      toast.success(`Your account is ready, ${user.name.split(" ")[0]}.`);
      navigate("/dashboard", { replace: true });
    } catch {
      setExpired(true);
    } finally {
      setLoading(false);
    }
  }

  if (!token || expired) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold text-ink">This link has expired</h1>
        <p className="mt-1 text-sm text-charcoal/60">
          Set-password links work once and last 7 days. We can send you a new one.
        </p>
        <div className="mt-6">
          <ButtonLink to="/forgot-password?setup=1" variant="cta" className="w-full">
            Send me a new link
          </ButtonLink>
        </div>
        <p className="mt-5 text-center text-sm text-charcoal/60">
          Already set it?{" "}
          <Link to="/login" className="font-medium text-leash hover:underline">
            Log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Finish setting up your account</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Choose a password. Your bookings and your pet are already saved to your account.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 space-y-4 rounded-2xl border border-mist bg-white p-6"
      >
        <Field label="Password" htmlFor="password" hint="At least 8 characters">
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>
        <Button type="submit" variant="cta" className="w-full" disabled={loading}>
          {loading ? "Setting up…" : "Set password and continue"}
        </Button>
      </form>
    </div>
  );
}
