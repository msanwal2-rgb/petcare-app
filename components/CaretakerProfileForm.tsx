"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type {
  CaretakerProfile,
  ServiceType,
  Species,
  PricingUnit,
} from "@/types";
import { upsertCaretakerProfile } from "@/lib/api/caretakers";
import { Field, Input, Textarea, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ServiceTypeChip } from "@/components/ServiceTypeChip";
import { SERVICE_LABELS, SPECIES_LABELS, cn } from "@/lib/utils";

const SERVICES: ServiceType[] = ["walking", "sitting", "boarding", "daycare"];
const SPECIES: Species[] = ["dog", "cat", "other"];

type PriceState = Record<string, { rate: number; unit: PricingUnit }>;

export function CaretakerProfileForm({
  userId,
  profile,
}: {
  userId: string;
  profile: CaretakerProfile | null;
}) {
  const router = useRouter();
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [services, setServices] = useState<ServiceType[]>(
    profile?.servicesOffered ?? ["walking"]
  );
  const [prices, setPrices] = useState<PriceState>(() => {
    const init: PriceState = {};
    for (const s of SERVICES) {
      const existing = profile?.pricing.find((p) => p.serviceType === s);
      init[s] = existing
        ? { rate: existing.rate, unit: existing.unit }
        : { rate: 25, unit: s === "boarding" || s === "daycare" ? "day" : "hour" };
    }
    return init;
  });
  const [radius, setRadius] = useState(profile?.serviceRadiusMiles ?? 10);
  const [accepted, setAccepted] = useState<Species[]>(
    profile?.acceptedSpecies ?? ["dog"]
  );
  const [home, setHome] = useState(
    profile?.homeEnvironment ?? {
      fencedYard: false,
      hasOtherPets: false,
      smokeFree: true,
    }
  );
  const [certs, setCerts] = useState((profile?.certifications ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  function toggle<T>(list: T[], value: T, set: (v: T[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function save() {
    if (services.length === 0) {
      toast.error("Offer at least one service.");
      return;
    }
    if (accepted.length === 0) {
      toast.error("Choose at least one pet type you accept.");
      return;
    }
    setSaving(true);
    try {
      await upsertCaretakerProfile(userId, {
        bio,
        servicesOffered: services,
        pricing: services.map((s) => ({
          serviceType: s,
          unit: prices[s].unit,
          rate: Number(prices[s].rate),
        })),
        serviceRadiusMiles: Number(radius),
        acceptedSpecies: accepted,
        homeEnvironment: home,
        certifications: certs.split(",").map((c) => c.trim()).filter(Boolean),
      });
      toast.success("Caretaker profile saved.");
      router.push("/dashboard");
    } catch {
      toast.error("Couldn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-7">
      <Field label="Bio" htmlFor="bio" hint="Sell yourself — why owners can trust you">
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="min-h-32"
          placeholder="Tell owners about your experience, your home, and how you care for pets…"
        />
      </Field>

      {/* Services + pricing */}
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Services &amp; pricing</p>
        <div className="space-y-2">
          {SERVICES.map((s) => {
            const on = services.includes(s);
            return (
              <div
                key={s}
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  on ? "border-ink/30 bg-white" : "border-mist bg-fog/50"
                )}
              >
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(services, s, setServices)}
                      className="h-4 w-4 accent-ink"
                    />
                    <ServiceTypeChip service={s} size="sm" />
                    <span className="text-sm text-charcoal">{SERVICE_LABELS[s]}</span>
                  </span>
                  {on && (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm text-charcoal/60">$</span>
                      <Input
                        type="number"
                        value={prices[s].rate}
                        onChange={(e) =>
                          setPrices((p) => ({
                            ...p,
                            [s]: { ...p[s], rate: Number(e.target.value) },
                          }))
                        }
                        className="w-20 px-2 py-1.5 text-sm"
                        aria-label={`${SERVICE_LABELS[s]} rate`}
                      />
                      <Select
                        value={prices[s].unit}
                        onChange={(e) =>
                          setPrices((p) => ({
                            ...p,
                            [s]: { ...p[s], unit: e.target.value as PricingUnit },
                          }))
                        }
                        className="w-auto px-2 py-1.5 text-sm"
                        aria-label={`${SERVICE_LABELS[s]} unit`}
                      >
                        <option value="hour">/hour</option>
                        <option value="day">/day</option>
                      </Select>
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Service radius (miles)" htmlFor="radius">
          <Input
            id="radius"
            type="number"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Pets you accept</p>
          <div className="flex gap-2">
            {SPECIES.map((s) => {
              const on = accepted.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(accepted, s, setAccepted)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
                    on
                      ? "border-ink bg-ink text-white"
                      : "border-mist bg-white text-charcoal hover:border-ink/40"
                  )}
                >
                  {SPECIES_LABELS[s]}s
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Home environment */}
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Home environment</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["fencedYard", "Fenced yard"],
              ["smokeFree", "Smoke-free"],
              ["hasOtherPets", "Other pets in home"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2.5 rounded-xl border border-mist bg-white px-4 py-3"
            >
              <input
                type="checkbox"
                checked={home[key]}
                onChange={(e) => setHome((h) => ({ ...h, [key]: e.target.checked }))}
                className="h-4 w-4 accent-ink"
              />
              <span className="text-sm text-charcoal">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <Field label="Certifications" htmlFor="certs" hint="Comma-separated">
        <Input
          id="certs"
          value={certs}
          onChange={(e) => setCerts(e.target.value)}
          placeholder="Pet First Aid & CPR, Insured & Bonded"
        />
      </Field>

      <div className="flex items-center justify-end gap-3 border-t border-mist pt-6">
        <Button type="button" variant="ghost" onClick={() => router.push("/dashboard")}>
          Cancel
        </Button>
        <Button type="button" variant="cta" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
