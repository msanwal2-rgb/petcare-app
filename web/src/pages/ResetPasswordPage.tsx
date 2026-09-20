import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { resetPassword } from "@/api/auth";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

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
      toast.error("Missing reset token.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      // Completing a reset invalidates every existing session, including any
      // this browser held — so the only correct destination is the login page.
      toast.success("Password updated — you can log in now.");
      navigate("/login", { replace: true });
    } catch {
      toast.error("This reset link is invalid or has expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Set a new password</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Choose a new password for your account.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 space-y-4 rounded-2xl border border-mist bg-white p-6"
      >
        <Field label="New password" htmlFor="password">
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
          {loading ? "Updating…" : "Update password"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-charcoal/60">
        <Link to="/login" className="font-medium text-leash hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
