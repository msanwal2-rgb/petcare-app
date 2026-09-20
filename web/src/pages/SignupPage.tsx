import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ApiError } from "@/api/_client";
import { signup } from "@/api/auth";
import { getPublicConfig } from "@/api/config";
import { destinationAfterAuth, loginWithGoogle, refreshSessionUser } from "@/auth/session";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * Mirrors the server's SignupRequestValidator, so the common mistakes are caught
 * without a round trip. The server is still the authority — this is a courtesy,
 * and the 400 it returns carries the same messages against the same field paths.
 */
const schema = z.object({
  name: z.string().min(1, "What should we call you?"),
  email: z.string().email("Enter a valid email."),
  phone: z.string().optional(),
  password: z.string().min(8, "Use at least 8 characters."),
});

type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    getPublicConfig()
      .then((config) => setGoogleEnabled(config.googleEnabled))
      .catch(() => setGoogleEnabled(false));
  }, []);

  async function onSubmit(values: FormValues) {
    try {
      // One request. The reference project posted to /api/signup and then
      // signed in separately, which meant submitting the password twice and
      // spending a sign-in attempt against the rate limiter; the API now
      // establishes the session in the same response.
      await signup({
        name: values.name,
        email: values.email,
        password: values.password,
        phone: values.phone,
        roles: [],
      });

      await refreshSessionUser();
      toast.success("Account created — one quick step to go.");
      navigate(destinationAfterAuth(location.search, "/onboarding"), { replace: true });
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 409
          ? "That email is already registered. Try logging in."
          : error instanceof ApiError && error.status === 503
            ? "New accounts are temporarily closed."
            : "Couldn’t create your account. Try again.",
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Book trusted care, or earn as a caretaker — you choose next.
      </p>

      {googleEnabled && (
        <div className="mt-6 rounded-2xl border border-mist bg-white p-6 pb-0">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => loginWithGoogle("/onboarding")}
          >
            Continue with Google
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-charcoal/40">
            <span className="h-px flex-1 bg-mist" />
            or with email
            <span className="h-px flex-1 bg-mist" />
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className={
          googleEnabled
            ? "space-y-4 rounded-b-2xl border border-t-0 border-mist bg-white px-6 pb-6"
            : "mt-6 space-y-4 rounded-2xl border border-mist bg-white p-6"
        }
      >
        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            {...register("name")}
            placeholder="Alex Morgan"
            autoComplete="name"
          />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            {...register("email")}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Phone" htmlFor="phone" hint="Optional">
          <Input
            id="phone"
            {...register("phone")}
            placeholder="(555) 555-0100"
            autoComplete="tel"
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            {...register("password")}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" variant="cta" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-charcoal/60">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-leash hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
