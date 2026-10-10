import { useNavigate } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ConsultMode, Species, VetProfile, VetSpecialty } from "@/types";
import { saveVetProfile } from "@/api/vets";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ToggleChips, toggleValue } from "@/components/ui/ToggleChips";
import { CITIES } from "@/lib/cities";
import {
  CONSULT_MODE_LABELS,
  CONSULT_MODE_OPTIONS,
  SPECIALTY_LABELS,
  SPECIALTY_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
} from "@/lib/utils";

/**
 * The clinic's listing. No rating, review count, response rate or
 * verification status: the first three are derived from completed visits
 * and the fourth is set by staff (REQUIREMENTS.md V11) — the patch type has
 * nowhere to put any of them.
 */
export function VetProfileForm({
  userId,
  profile,
}: {
  userId: string;
  profile: VetProfile | null;
}) {
  const navigate = useNavigate();
  const [clinicName, setClinicName] = useState(profile?.clinicName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [specialties, setSpecialties] = useState<VetSpecialty[]>(
    profile?.specialties ?? ["general"]
  );
  const [licenseNumber, setLicenseNumber] = useState(profile?.licenseNumber ?? "");
  const [licenseState, setLicenseState] = useState(profile?.licenseState ?? "");
  const [yearsExperience, setYearsExperience] = useState(profile?.yearsExperience ?? 0);
  const [accepted, setAccepted] = useState<Species[]>(
    profile?.acceptedSpecies ?? ["dog", "cat"]
  );
  const [modes, setModes] = useState<ConsultMode[]>(
    profile?.consultModes ?? ["in_clinic"]
  );
  const [consultFee, setConsultFee] = useState(profile?.consultFee ?? 85);
  const [emergency, setEmergency] = useState(profile?.emergencyAvailable ?? false);
  const [city, setCity] = useState(profile?.clinic.city ?? "");
  const [state, setState] = useState(profile?.clinic.state ?? "");
  const [clinicPhone, setClinicPhone] = useState(profile?.clinic.phone ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!clinicName.trim()) return toast.error("Add your clinic name.");
    if (!licenseNumber.trim()) return toast.error("A licence number is required.");
    if (specialties.length === 0) return toast.error("Choose at least one specialty.");
    if (accepted.length === 0) return toast.error("Choose at least one species you treat.");
    if (modes.length === 0) return toast.error("Offer at least one consultation format.");

    setSaving(true);
    try {
      // Geocode the clinic so it shows up in distance-sorted searches. Falls
      // back to the previous coordinates when the city isn't one we know.
      const known = CITIES.find((c) => city.toLowerCase().includes(c.id));
      const coords = (known && { lat: known.lat, lng: known.lng }) ??
        (profile ? { lat: profile.clinic.lat, lng: profile.clinic.lng } : { lat: 0, lng: 0 });

      await saveVetProfile(userId, {
        bio,
        specialties,
        licenseNumber: licenseNumber.trim(),
        licenseState: licenseState.trim().toUpperCase(),
        yearsExperience: Number(yearsExperience),
        acceptedSpecies: accepted,
        consultModes: modes,
        consultFee: Number(consultFee),
        emergencyAvailable: emergency,
        clinic: {
          name: clinicName.trim(),
          city: city.trim(),
          state: state.trim().toUpperCase(),
          ...coords,
          phone: clinicPhone.trim(),
        },
      });
      toast.success("Clinic profile saved.");
      navigate("/dashboard");
    } catch (e) {
      toast.error("Couldn't save your profile", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-7">
      <Field label="Clinic or practice name" htmlFor="v-clinic">
        <Input
          id="v-clinic"
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          placeholder="South Austin Animal Hospital"
        />
      </Field>

      <Field
        label="About your practice"
        htmlFor="v-bio"
        hint="What owners should know before booking"
      >
        <Textarea
          id="v-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className="min-h-32"
          placeholder="Your approach, the cases you see most, and how you like to work with owners…"
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium text-ink">Specialties</p>
        <ToggleChips
          options={SPECIALTY_OPTIONS}
          selected={specialties}
          onToggle={(v) => setSpecialties((cur) => toggleValue(cur, v))}
          label={(v) => SPECIALTY_LABELS[v]}
          size="sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field label="Licence number" htmlFor="v-lic">
          <Input
            id="v-lic"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            placeholder="TX-VM-44219"
          />
        </Field>
        <Field label="Licensing state" htmlFor="v-lic-state">
          <Input
            id="v-lic-state"
            value={licenseState}
            onChange={(e) => setLicenseState(e.target.value)}
            placeholder="TX"
            maxLength={2}
          />
        </Field>
        <Field label="Years in practice" htmlFor="v-years">
          <Input
            id="v-years"
            type="number"
            min={0}
            value={yearsExperience}
            onChange={(e) => setYearsExperience(Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Species you treat</p>
          <ToggleChips
            options={SPECIES_OPTIONS}
            selected={accepted}
            onToggle={(v) => setAccepted((cur) => toggleValue(cur, v))}
            label={(v) => `${SPECIES_LABELS[v]}s`}
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Consultation formats</p>
          <ToggleChips
            options={CONSULT_MODE_OPTIONS}
            selected={modes}
            onToggle={(v) => setModes((cur) => toggleValue(cur, v))}
            label={(v) => CONSULT_MODE_LABELS[v]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field label="Consultation fee (USD)" htmlFor="v-fee">
          <Input
            id="v-fee"
            type="number"
            min={0}
            value={consultFee}
            onChange={(e) => setConsultFee(Number(e.target.value))}
          />
        </Field>
        <Field label="Clinic city" htmlFor="v-city">
          <Input
            id="v-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Austin"
          />
        </Field>
        <Field label="Clinic state" htmlFor="v-state">
          <Input
            id="v-state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="TX"
            maxLength={2}
          />
        </Field>
      </div>

      {/* Not in the reference form: the reference showed owners the vet's
          personal phone. This is the practice's line, and it is what the
          emergency panel on the profile tells owners to call. */}
      <Field
        label="Clinic phone"
        htmlFor="v-phone"
        hint="Public — shown to owners for emergencies"
      >
        <Input
          id="v-phone"
          type="tel"
          value={clinicPhone}
          onChange={(e) => setClinicPhone(e.target.value)}
          placeholder="(512) 555-0100"
          autoComplete="tel"
        />
      </Field>

      <label className="flex items-center gap-2.5 rounded-xl border border-mist bg-white px-4 py-3">
        <input
          type="checkbox"
          checked={emergency}
          onChange={(e) => setEmergency(e.target.checked)}
          className="h-4 w-4 accent-ink"
        />
        <span className="text-sm text-charcoal">
          We take emergencies
          <span className="ml-1 text-charcoal/55">
            — shown prominently, and owners are told to phone rather than book
          </span>
        </span>
      </label>

      <p className="rounded-xl bg-fog px-4 py-3 text-xs text-charcoal/70">
        Your rating and review count are calculated from completed appointments —
        they aren&apos;t editable here.
      </p>

      <div className="flex items-center justify-end gap-3 border-t border-mist pt-6">
        <Button type="button" variant="ghost" onClick={() => navigate("/dashboard")}>
          Cancel
        </Button>
        <Button type="button" variant="cta" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}
