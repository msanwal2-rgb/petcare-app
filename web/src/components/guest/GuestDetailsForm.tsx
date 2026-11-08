import type { Sex, Species } from "@/types";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { todayKey, type GuestDetails, type GuestErrors } from "./guestDetails";

/**
 * "Your details & your pet" — what a guest gives instead of choosing one of
 * their pets (STATUS §3-G). Shared by the caretaker and vet booking forms;
 * the state and rules are in `guestDetails.ts`.
 */
export function GuestDetailsForm({
  value,
  onChange,
  errors,
  providerName,
}: {
  value: GuestDetails;
  onChange: (next: GuestDetails) => void;
  errors: GuestErrors;
  /** "Liam" — who will see the phone number. */
  providerName: string;
}) {
  const set = <K extends keyof GuestDetails>(key: K, v: GuestDetails[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Your details</h2>
        <p className="mt-0.5 text-sm text-charcoal/60">
          {providerName} will use these to reach you about this request.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="g-name" error={errors.name} className="sm:col-span-2">
            <Input id="g-name" autoComplete="name" value={value.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="g-email" error={errors.email}>
            <Input
              id="g-email"
              type="email"
              autoComplete="email"
              value={value.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Phone" htmlFor="g-phone" error={errors.phone}>
            <Input
              id="g-phone"
              type="tel"
              autoComplete="tel"
              value={value.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+1 512 555 0100"
            />
          </Field>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-ink">Your pet</h2>
        <p className="mt-0.5 text-sm text-charcoal/60">
          The basics. You can fill in the rest once you have an account.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="g-pet" error={errors.petName}>
            <Input id="g-pet" value={value.petName} onChange={(e) => set("petName", e.target.value)} />
          </Field>
          <Field label="Species" htmlFor="g-species" error={errors.species}>
            <Select
              id="g-species"
              value={value.species}
              onChange={(e) => set("species", e.target.value as Species)}
            >
              <option value="dog">Dog</option>
              <option value="cat">Cat</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Breed" htmlFor="g-breed" hint="Optional" error={errors.breed}>
            <Input
              id="g-breed"
              value={value.breed}
              onChange={(e) => set("breed", e.target.value)}
              placeholder="Beagle, mixed…"
            />
          </Field>
          <Field label="Sex" htmlFor="g-sex" error={errors.sex}>
            <Select id="g-sex" value={value.sex} onChange={(e) => set("sex", e.target.value as Sex)}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </Select>
          </Field>
          <Field label="Date of birth" htmlFor="g-dob" error={errors.dob}>
            <Input
              id="g-dob"
              type="date"
              max={todayKey()}
              value={value.dob}
              onChange={(e) => set("dob", e.target.value)}
            />
          </Field>
          <Field label="Weight (lb)" htmlFor="g-weight" error={errors.weightLbs}>
            <Input
              id="g-weight"
              type="number"
              inputMode="numeric"
              min={0}
              max={400}
              step={1}
              value={value.weightLbs}
              onChange={(e) => set("weightLbs", e.target.value)}
            />
          </Field>
          <Field
            label="Allergies"
            htmlFor="g-allergies"
            hint="Optional, comma-separated"
            error={errors.allergies}
            className="sm:col-span-2"
          >
            <Input
              id="g-allergies"
              value={value.allergies}
              onChange={(e) => set("allergies", e.target.value)}
              placeholder="chicken, grass pollen"
            />
          </Field>
          <Field
            label="Anything they should know"
            htmlFor="g-notes"
            hint="Optional"
            error={errors.behaviorNotes}
            className="sm:col-span-2"
          >
            <Textarea
              id="g-notes"
              value={value.behaviorNotes}
              onChange={(e) => set("behaviorNotes", e.target.value)}
              placeholder="Temperament, routines, medical notes…"
            />
          </Field>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-mist bg-fog/60 px-4 py-3">
        <input
          type="checkbox"
          checked={value.saveAccount}
          onChange={(e) => set("saveAccount", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-ink"
        />
        <span className="text-sm text-charcoal">
          <span className="font-medium text-ink">Save my details and create a Leash account.</span>{" "}
          We’ll email you a link to set a password, so you can follow this booking and message{" "}
          {providerName}.
        </span>
      </label>
    </div>
  );
}
