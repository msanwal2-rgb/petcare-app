import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-xl border border-mist bg-white px-3.5 py-2.5 text-sm text-charcoal " +
  "placeholder:text-charcoal/40 transition-colors focus:border-ink focus:outline-none " +
  "focus:ring-2 focus:ring-ink/15 disabled:opacity-60";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-ink"
      >
        <span>{label}</span>
        {hint && <span className="text-xs font-normal text-charcoal/50">{hint}</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-xs text-leash" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 resize-y", className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
}
