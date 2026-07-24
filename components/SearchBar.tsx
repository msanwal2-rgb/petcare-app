"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ServiceType } from "@/types";
import { Button } from "@/components/ui/Button";
import { MapPinIcon, CalendarIcon, SearchIcon } from "./ui/icons";
import { SERVICE_LABELS } from "@/lib/utils";
import { cn } from "@/lib/utils";

const SERVICES: ServiceType[] = ["walking", "sitting", "boarding", "daycare"];

/**
 * Location + service + dates search widget (brief §5). Builds a query string
 * and routes to /search — the search page reads these params and calls
 * searchCaretakers(). Used on the landing hero and can be reused elsewhere.
 */
export function SearchBar({
  variant = "hero",
  initial,
}: {
  variant?: "hero" | "inline";
  initial?: { location?: string; service?: string; startDate?: string; endDate?: string };
}) {
  const router = useRouter();
  const [location, setLocation] = useState(initial?.location ?? "Austin, TX");
  const [service, setService] = useState(initial?.service ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (location) params.set("location", location);
    if (service) params.set("service", service);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    router.push(`/search?${params.toString()}`);
  }

  const fieldBase =
    "w-full bg-transparent text-sm text-charcoal placeholder:text-charcoal/40 focus:outline-none";

  return (
    <form
      onSubmit={submit}
      className={cn(
        "grid gap-2 rounded-2xl border border-mist bg-white/95 p-2 shadow-xl shadow-ink/10 backdrop-blur",
        variant === "hero"
          ? "grid-cols-1 sm:grid-cols-[1.3fr_1fr_1fr_auto]"
          : "grid-cols-1 sm:grid-cols-[1.3fr_1fr_1fr_1fr_auto]"
      )}
    >
      <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
        <MapPinIcon width={18} height={18} className="shrink-0 text-ink/60" />
        <span className="sr-only">Location</span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City or ZIP"
          className={fieldBase}
        />
      </label>

      <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
        <SearchIcon width={18} height={18} className="shrink-0 text-ink/60" />
        <span className="sr-only">Service</span>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className={cn(fieldBase, "cursor-pointer")}
        >
          <option value="">Any service</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {SERVICE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
        <CalendarIcon width={18} height={18} className="shrink-0 text-ink/60" />
        <span className="sr-only">Start date</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={cn(fieldBase, "font-mono text-xs")}
        />
      </label>

      {variant === "inline" && (
        <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
          <CalendarIcon width={18} height={18} className="shrink-0 text-ink/60" />
          <span className="sr-only">End date</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={cn(fieldBase, "font-mono text-xs")}
          />
        </label>
      )}

      <Button type="submit" variant="cta" size="md" className="sm:px-6">
        <SearchIcon width={16} height={16} />
        Search
      </Button>
    </form>
  );
}
