"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { createUser } from "@/lib/api/users";
import { useSession } from "@/lib/store/session";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const schema = z.object({
  name: z.string().min(1, "What should we call you?"),
  email: z.string().email("Enter a valid email."),
  phone: z.string().optional(),
  password: z.string().min(6, "Use at least 6 characters."),
});
type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const router = useRouter();
  const { setUser } = useSession();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      const user = await createUser({
        name: values.name,
        email: values.email,
        phone: values.phone,
        roles: [],
      });
      setUser(user);
      toast.success("Account created — one quick step to go.");
      router.push("/onboarding");
    } catch {
      toast.error("Couldn’t create your account. Try again.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Book trusted care, or earn as a caretaker — you choose next.
      </p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 space-y-4 rounded-2xl border border-mist bg-white p-6"
      >
        <Field label="Full name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" {...register("name")} placeholder="Alex Morgan" autoComplete="name" />
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
          <Input id="phone" {...register("phone")} placeholder="(555) 555-0100" autoComplete="tel" />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" {...register("password")} placeholder="••••••••" />
        </Field>
        <Button type="submit" variant="cta" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-charcoal/60">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-leash hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
