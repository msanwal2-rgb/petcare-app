import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { forgotPassword } from "@/api/auth";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await forgotPassword(email.trim());
      setSent(true);
      if (res.devLink) setDevLink(res.devLink);
    } catch {
      toast.error("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Enter your email and we’ll send you a link to set a new password.
      </p>

      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        {sent ? (
          <div className="text-sm text-charcoal/70">
            {/*
              Deliberately conditional language. The server answers { ok: true }
              whether or not an account exists at that address, and this copy has
              to match — "we've sent you a link" would confirm the account and
              turn the form into a membership lookup.
            */}
            <p>
              If an account exists for <strong>{email}</strong>, a reset link is on
              its way. Check your inbox.
            </p>
            {devLink && (
              <p className="mt-4 break-all rounded-lg bg-fog p-3 font-mono text-[11px]">
                Dev mode — reset link:{" "}
                <a href={devLink} className="text-leash underline">
                  {devLink}
                </a>
              </p>
            )}
          </div>
        ) : (
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
            <Button type="submit" variant="cta" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </div>

      <p className="mt-5 text-center text-sm text-charcoal/60">
        Remembered it?{" "}
        <Link to="/login" className="font-medium text-leash hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
