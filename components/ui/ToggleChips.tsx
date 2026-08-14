"use client";

import { cn } from "@/lib/utils";

/**
 * Multi-select chip group. Used wherever a profile picks from a small fixed
 * vocabulary — services offered, species accepted, specialties, consultation
 * formats — which is otherwise the same twenty lines written five times.
 */
export function ToggleChips<T extends string>({
  options,
  selected,
  onToggle,
  label,
  size = "md",
  className,
}: {
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  /** Renders each value as its display string. */
  label: (value: T) => string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            aria-pressed={on}
            className={cn(
              "rounded-xl border transition-colors",
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm",
              on
                ? "border-ink bg-ink text-white"
                : "border-mist bg-white text-charcoal hover:border-ink/40"
            )}
          >
            {label(option)}
          </button>
        );
      })}
    </div>
  );
}

/** Add/remove a value from a selection — the reducer every caller was writing. */
export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
