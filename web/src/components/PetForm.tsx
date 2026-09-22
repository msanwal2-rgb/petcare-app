import { useState, type FormEvent } from "react";
import type { Pet } from "@/types";
import type { PetInput } from "@/api/pets";
import { ApiError } from "@/api/_client";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { SPECIES_LABELS } from "@/lib/utils";

/**
 * The create/edit form for one animal.
 *
 * ── There is no owner field, and that is the point ──
 *
 * The reference project's version spread `ownerId` into every submit payload.
 * Combined with a patch schema that accepted it and a route that checked only
 * the *outgoing* owner, that was a transfer backdoor: a stale prop could hand
 * somebody's pet to another account with no consent, audit or notification.
 * `PetInput` has no such property, so the form cannot send one.
 */
export function PetForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Pet;
  submitLabel: string;
  onSubmit: (input: PetInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<PetInput>(() => toInput(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Field-level messages from the API's error envelope, keyed by the JSON path
   * the validation filter emits (`species`, `vetContact.name`). Shown under the
   * field that caused them rather than as one banner.
   */
  const [issues, setIssues] = useState<Record<string, string>>({});

  function set<K extends keyof PetInput>(key: K, value: PetInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setIssues({});

    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
        >
          {error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={issues.name}>
          <Input
            id="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Biscuit"
            required
          />
        </Field>

        <Field label="Species" htmlFor="species" error={issues.species}>
          <Select
            id="species"
            value={values.species}
            onChange={(e) => set("species", e.target.value as Pet["species"])}
          >
            {(Object.keys(SPECIES_LABELS) as Pet["species"][]).map((s) => (
              <option key={s} value={s}>
                {SPECIES_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Breed" htmlFor="breed" error={issues.breed}>
          <Input
            id="breed"
            value={values.breed}
            onChange={(e) => set("breed", e.target.value)}
            placeholder="Golden Retriever"
          />
        </Field>

        <Field label="Sex" htmlFor="sex" error={issues.sex}>
          <Select
            id="sex"
            value={values.sex}
            onChange={(e) => set("sex", e.target.value as Pet["sex"])}
          >
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </Field>

        <Field label="Date of birth" htmlFor="dob" error={issues.dob}>
          <Input
            id="dob"
            type="date"
            value={values.dob}
            onChange={(e) => set("dob", e.target.value)}
            required
          />
        </Field>

        <Field label="Weight" hint="lb" htmlFor="weightLbs" error={issues.weightLbs}>
          <Input
            id="weightLbs"
            type="number"
            min={0}
            max={400}
            value={values.weightLbs}
            onChange={(e) => set("weightLbs", Number(e.target.value))}
          />
        </Field>
      </div>

      <Field
        label="Allergies"
        hint="comma separated"
        htmlFor="allergies"
        error={issues.allergies}
      >
        <Input
          id="allergies"
          value={values.allergies.join(", ")}
          onChange={(e) => set("allergies", splitList(e.target.value))}
          placeholder="Chicken, Certain grains"
        />
      </Field>

      <Field
        label="Medications"
        hint="comma separated"
        htmlFor="medications"
        error={issues.medications}
      >
        <Input
          id="medications"
          value={values.medications.join(", ")}
          onChange={(e) => set("medications", splitList(e.target.value))}
          placeholder="Gabapentin 25mg — 1 capsule if travelling"
        />
      </Field>

      <Field
        label="Feeding instructions"
        htmlFor="feedingInstructions"
        error={issues.feedingInstructions}
      >
        <Textarea
          id="feedingInstructions"
          value={values.feedingInstructions}
          onChange={(e) => set("feedingInstructions", e.target.value)}
          placeholder="2 cups dry food, morning and evening. No table scraps."
        />
      </Field>

      <Field label="Behaviour notes" htmlFor="behaviorNotes" error={issues.behaviorNotes}>
        <Textarea
          id="behaviorNotes"
          value={values.behaviorNotes}
          onChange={(e) => set("behaviorNotes", e.target.value)}
          placeholder="Friendly with everyone, pulls a little on the leash."
        />
      </Field>

      <fieldset className="rounded-xl border border-mist p-4">
        <legend className="px-1.5 text-sm font-medium text-ink">Your vet</legend>
        <p className="mb-4 text-xs text-charcoal/55">
          Shared with a sitter while they are looking after {values.name || "your pet"}.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Practice" htmlFor="vetName" error={issues["vetContact.name"]}>
            <Input
              id="vetName"
              value={values.vetContact.name}
              onChange={(e) =>
                set("vetContact", { ...values.vetContact, name: e.target.value })
              }
              required
            />
          </Field>
          <Field label="Phone" htmlFor="vetPhone" error={issues["vetContact.phone"]}>
            <Input
              id="vetPhone"
              type="tel"
              value={values.vetContact.phone}
              onChange={(e) =>
                set("vetContact", { ...values.vetContact, phone: e.target.value })
              }
              required
            />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" variant="cta" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Chicken, , Grains " -> ["Chicken", "Grains"] — blanks dropped, not stored. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toInput(pet?: Pet): PetInput {
  if (pet) {
    const { id: _id, ownerId: _ownerId, ...input } = pet;
    return input;
  }

  return {
    name: "",
    species: "dog",
    breed: "",
    sex: "female",
    dob: "",
    weightLbs: 0,
    photoUrl: "",
    vaccinated: false,
    allergies: [],
    medications: [],
    behaviorNotes: "",
    feedingInstructions: "",
    vetContact: { name: "", phone: "" },
  };
}
