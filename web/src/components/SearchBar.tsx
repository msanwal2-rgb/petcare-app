import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { ServiceType } from "@/types";
import { Button } from "@/components/ui/Button";
import { CalendarIcon, MapPinIcon, SearchIcon } from "./ui/icons";
import { CITIES } from "@/lib/cities";
import { SERVICE_LABELS, cn } from "@/lib/utils";

/**
 * City + service + date, routed to `/search`.
 *
 * ── Every control here maps to a real API parameter ──
 *
 * That is the one way this differs from the reference implementation's version,
 * and it is deliberate. Its search bar collected a free-text `location` and a
 * `service`, and put both in the query string — but `GET /caretakers/search`
 * takes `lat`/`lng`/`radiusMiles` and `serviceType`, so the location box
 * filtered nothing and the service name was the wrong key. Two of its four
 * controls were decorative.
 *
 * Here the city picker carries coordinates (see `lib/cities.ts`), the service
 * select emits `serviceType`, and the date emits `startDate` — which the
 * repository turns into an `EXISTS` against `availability_days`. Press Search
 * and the result set actually changes.
 */
export function SearchBar({
  variant = "hero",
  initial,
}: {
  variant?: "hero" | "inline";
  initial?: { city?: string; serviceType?: string; startDate?: string };
}) {
  const navigate = useNavigate();
  const [city, setCity] = useState(initial?.city ?? "");
  const [serviceType, setServiceType] = useState(initial?.serviceType ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();

    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (serviceType) params.set("serviceType", serviceType);
    if (startDate) params.set("startDate", startDate);

    navigate(`/search?${params.toString()}`);
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
          : "grid-cols-1 sm:grid-cols-[1.3fr_1fr_1fr_auto]",
      )}
    >
      <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
        <MapPinIcon width={18} height={18} className="shrink-0 text-ink/60" />
        <span className="sr-only">City</span>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={cn(fieldBase, "cursor-pointer")}
        >
          <option value="">Anywhere</option>
          {CITIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
        <SearchIcon width={18} height={18} className="shrink-0 text-ink/60" />
        <span className="sr-only">Service</span>
        <select
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          className={cn(fieldBase, "cursor-pointer")}
        >
          <option value="">Any service</option>
          {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((s) => (
            <option key={s} value={s}>
              {SERVICE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:bg-fog">
        <CalendarIcon width={18} height={18} className="shrink-0 text-ink/60" />
        <span className="sr-only">Available from</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={cn(fieldBase, "font-mono text-xs")}
        />
      </label>

      <Button type="submit" variant="cta" size="md" className="sm:px-6">
        <SearchIcon width={16} height={16} />
        Search
      </Button>
    </form>
  );
}
