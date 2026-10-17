import { useNavigate } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { ShelterKind, ShelterProfile, Species } from "@/types";
import { upsertShelterProfile } from "@/api/shelters";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ToggleChips, toggleValue } from "@/components/ui/ToggleChips";
import { CITIES } from "@/lib/cities";
import { SPECIES_LABELS, SPECIES_OPTIONS } from "@/lib/utils";

/**
 * The shelter profile form — the reference's `components/shelter/ShelterProfileForm.tsx`.
 *
 * The fields a shelter does not get to set — verification and response rate —
 * are absent rather than disabled. Geocoding follows `VetProfileForm`: a city
 * we know gets its coordinates, anything else keeps the previous ones.
 */

const KIND_LABELS: Record<ShelterKind, string> = {
  municipal: "Municipal shelter",
  rescue: "Rescue organisation",
  sanctuary: "Sanctuary",
  foster_network: "Foster network",
};
const KINDS = Object.keys(KIND_LABELS) as ShelterKind[];

export function ShelterProfileForm({ userId, profile }: { userId: string; profile: ShelterProfile | null }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(profile?.name ?? "");
  const [kind, setKind] = useState<ShelterKind>(profile?.kind ?? "rescue");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(profile?.registrationNumber ?? "");
  const [registrationState, setRegistrationState] = useState(profile?.registrationState ?? "");
  const [acceptedSpecies, setAcceptedSpecies] = useState<Species[]>(profile?.acceptedSpecies ?? ["dog", "cat"]);
  const [websiteUrl, setWebsiteUrl] = useState(profile?.websiteUrl ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [line, setLine] = useState(profile?.address.line ?? "");
  const [city, setCity] = useState(profile?.address.city ?? "");
  const [state, setState] = useState(profile?.address.state ?? "");
  const [adoptionPolicy, setAdoptionPolicy] = useState(profile?.adoptionPolicy ?? "");

  async function save() {
    if (!name.trim()) {
      toast.error("Your shelter needs a name.");
      return;
    }
    if (!city.trim() || !state.trim()) {
      toast.error("Adopters search by place — we need a city and state.");
      return;
    }

    setSaving(true);
    try {
      // The profile carries its own coordinates because a shelter is a place
      // people drive to, not an account holder's home address.
      const known = CITIES.find((c) => city.toLowerCase().includes(c.id));
      const coords = (known && { lat: known.lat, lng: known.lng }) ?? {
        lat: profile?.address.lat ?? 0,
        lng: profile?.address.lng ?? 0,
      };

      await upsertShelterProfile(userId, {
        name: name.trim(),
        kind,
        bio: bio.trim(),
        registrationNumber: registrationNumber.trim(),
        registrationState: registrationState.trim(),
        acceptedSpecies,
        websiteUrl: websiteUrl.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: { line: line.trim(), city: city.trim(), state: state.trim(), ...coords },
        adoptionPolicy: adoptionPolicy.trim(),
      });
      toast.success("Shelter profile saved.");
      navigate("/dashboard");
    } catch (e) {
      toast.error("Couldn't save that", { description: e instanceof Error ? e.message : undefined });
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Shelter name" htmlFor="shelter-name">
        <Input id="shelter-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Austin Pets Alive" />
      </Field>

      <Field label="What kind of organisation" htmlFor="shelter-kind">
        <Select id="shelter-kind" value={kind} onChange={(e) => setKind(e.target.value as ShelterKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="About you"
        htmlFor="shelter-bio"
        hint="What you take in, and how you work. Adopters read this first."
      >
        <Textarea id="shelter-bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
      </Field>

      <Field label="Animals you take" htmlFor="shelter-species">
        <ToggleChips
          label={(s) => SPECIES_LABELS[s]}
          options={SPECIES_OPTIONS}
          selected={acceptedSpecies}
          size="sm"
          onToggle={(s) => setAcceptedSpecies(toggleValue(acceptedSpecies, s))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registration or charity number" htmlFor="shelter-reg" hint="Shown to adopters once verified.">
          <Input id="shelter-reg" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
        </Field>
        <Field label="Registered in" htmlFor="shelter-reg-state">
          <Input
            id="shelter-reg-state"
            value={registrationState}
            onChange={(e) => setRegistrationState(e.target.value)}
            placeholder="TX"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="shelter-phone">
          <Input id="shelter-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="shelter-email">
          <Input id="shelter-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      <Field label="Website" htmlFor="shelter-web">
        <Input id="shelter-web" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://" />
      </Field>

      <Field label="Street address" htmlFor="shelter-line">
        <Input id="shelter-line" value={line} onChange={(e) => setLine(e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" htmlFor="shelter-city">
          <Input id="shelter-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="State" htmlFor="shelter-state">
          <Input id="shelter-state" value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
      </div>

      <Field
        label="What an adopter should expect"
        htmlFor="shelter-policy"
        hint="Home checks, references, how long it takes, what the fee covers. Being specific here saves everybody a conversation."
      >
        <Textarea id="shelter-policy" rows={5} value={adoptionPolicy} onChange={(e) => setAdoptionPolicy(e.target.value)} />
      </Field>

      <p className="rounded-xl bg-fog px-4 py-3 text-xs text-charcoal/70">
        Your verification status and response rate aren&apos;t editable here.
        One is checked by a person on our side; the other is worked out from how
        quickly you answer applications.
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
