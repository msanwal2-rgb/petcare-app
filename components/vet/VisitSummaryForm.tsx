"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { MedicalRecordType } from "@/types";
import { createRecord, type MedicalRecordInput } from "@/lib/api/medical-records";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { RECORD_TYPE_LABELS, RECORD_TYPE_OPTIONS, cn } from "@/lib/utils";

/** "allergy" is owner-reported and lives on the pet, not a visit. */
const AUTHORABLE_TYPES = RECORD_TYPE_OPTIONS.filter((t) => t !== "allergy");

/**
 * The vet's write surface on a pet's health record.
 *
 * Which fields appear follows the entry type — a vaccination needs a next-due
 * date, a prescription needs a medication, dosage, refills and an expiry, and
 * a visit note needs neither. Showing all of them at once is how clinical
 * forms end up half-filled.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);

export function VisitSummaryForm({
  petId,
  appointmentId,
  onCreated,
  /** Entry types the current user is allowed to write. */
  allowedTypes = AUTHORABLE_TYPES,
  className,
}: {
  petId: string;
  appointmentId?: string;
  onCreated?: () => void;
  allowedTypes?: MedicalRecordType[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MedicalRecordType>(allowedTypes[0]);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [nextDueOn, setNextDueOn] = useState("");
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [refillsLeft, setRefillsLeft] = useState("3");
  const [expiresOn, setExpiresOn] = useState("");
  const [productSlugs, setProductSlugs] = useState("");
  const [saving, setSaving] = useState(false);

  const isPrescription = type === "prescription";
  const isVaccination = type === "vaccination";

  function reset() {
    setTitle("");
    setDetails("");
    setOccurredOn(todayIso());
    setNextDueOn("");
    setMedicationName("");
    setDosage("");
    setRefillsLeft("3");
    setExpiresOn("");
    setProductSlugs("");
  }

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const input: MedicalRecordInput = {
        type,
        title: title.trim(),
        details: details.trim(),
        occurredAt: new Date(`${occurredOn}T12:00:00Z`).toISOString(),
        appointmentId: appointmentId ?? null,
        nextDueAt: nextDueOn ? new Date(`${nextDueOn}T00:00:00Z`).toISOString() : null,
        medicationName: isPrescription ? medicationName.trim() || null : null,
        dosage: isPrescription ? dosage.trim() || null : null,
        refillsLeft: isPrescription ? Number(refillsLeft) : null,
        expiresAt:
          isPrescription && expiresOn
            ? new Date(`${expiresOn}T00:00:00Z`).toISOString()
            : null,
        productSlugs: productSlugs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await createRecord(petId, input);
      toast.success(`${RECORD_TYPE_LABELS[type]} added to the record`);
      reset();
      setOpen(false);
      onCreated?.();
    } catch (e) {
      toast.error("Couldn't save that record", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        className={className}
        onClick={() => setOpen(true)}
      >
        Add to health record
      </Button>
    );
  }

  return (
    <div className={cn("space-y-4 rounded-2xl border border-mist bg-white p-5", className)}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Entry type" htmlFor="r-type">
          <Select
            id="r-type"
            value={type}
            onChange={(e) => setType(e.target.value as MedicalRecordType)}
          >
            {allowedTypes.map((t) => (
              <option key={t} value={t}>
                {RECORD_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Date" htmlFor="r-date">
          <Input
            id="r-date"
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Title" htmlFor="r-title" hint="Required">
        <Input
          id="r-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            isPrescription
              ? "e.g. Apoquel 5.4 mg"
              : isVaccination
                ? "e.g. Rabies (3-year)"
                : "e.g. Dental cleaning with radiographs"
          }
        />
      </Field>

      <Field label="Details" htmlFor="r-details">
        <Textarea
          id="r-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Findings, plan, and what the owner should watch for."
        />
      </Field>

      {isPrescription && (
        <div className="grid grid-cols-1 gap-4 rounded-xl bg-fog p-4 sm:grid-cols-2">
          <Field label="Medication" htmlFor="r-med">
            <Input
              id="r-med"
              value={medicationName}
              onChange={(e) => setMedicationName(e.target.value)}
              placeholder="Drug or therapeutic diet"
            />
          </Field>
          <Field label="Dosage" htmlFor="r-dose">
            <Input
              id="r-dose"
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="1 tablet with breakfast"
            />
          </Field>
          <Field label="Refills" htmlFor="r-refills">
            <Input
              id="r-refills"
              type="number"
              min={0}
              value={refillsLeft}
              onChange={(e) => setRefillsLeft(e.target.value)}
            />
          </Field>
          <Field
            label="Valid until"
            htmlFor="r-expires"
            hint="Leave empty for no expiry"
          >
            <Input
              id="r-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </Field>
        </div>
      )}

      {(isVaccination || type === "visit_note") && (
        <Field label="Next due" htmlFor="r-next" hint="Optional">
          <Input
            id="r-next"
            type="date"
            value={nextDueOn}
            onChange={(e) => setNextDueOn(e.target.value)}
          />
        </Field>
      )}

      <Field
        label="Recommend store products"
        htmlFor="r-products"
        hint="Comma-separated slugs"
      >
        <Input
          id="r-products"
          value={productSlugs}
          onChange={(e) => setProductSlugs(e.target.value)}
          placeholder="vetline-hypoallergenic-cat-dry"
        />
      </Field>
      {isPrescription && (
        <p className="-mt-2 text-xs text-charcoal/60">
          Listing a prescription-only product here is what authorises this
          owner to buy it in the store.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="cta" disabled={saving || !title.trim()} onClick={submit}>
          {saving ? "Saving…" : "Save to record"}
        </Button>
      </div>
    </div>
  );
}
