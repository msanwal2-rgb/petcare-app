import { Link } from "react-router";
import type { MedicalRecord, MedicalRecordType } from "@/types";
import {
  AlertIcon,
  CheckIcon,
  PillIcon,
  StethoscopeIcon,
  SyringeIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { RECORD_TYPE_LABELS, cn, formatDate } from "@/lib/utils";

const ICON: Record<MedicalRecordType, typeof CheckIcon> = {
  visit_note: StethoscopeIcon,
  vaccination: SyringeIcon,
  prescription: PillIcon,
  lab_result: CheckIcon,
  weight: CheckIcon,
  allergy: AlertIcon,
};

const ACCENT: Record<MedicalRecordType, string> = {
  visit_note: "text-ink bg-ink/8",
  vaccination: "text-[#215144] bg-[#2F6F5E]/12",
  prescription: "text-[#946412] bg-marigold/15",
  lab_result: "text-ink bg-ink/8",
  weight: "text-charcoal/70 bg-charcoal/8",
  allergy: "text-[#a83c27] bg-leash/12",
};

/** Is this prescription still usable — unexpired and with refills left? */
function prescriptionActive(record: MedicalRecord, now = new Date()): boolean {
  if (record.type !== "prescription") return false;
  if (record.refillsLeft === 0) return false;
  return !record.expiresAt || new Date(record.expiresAt) > now;
}

/**
 * One entry in a pet's health timeline.
 *
 * `onDelete` is offered only to the entry's author — an owner can withdraw a
 * weight they mistyped, but not a diagnosis a vet wrote about their animal.
 */
export function MedicalRecordCard({
  record,
  onDelete,
  className,
}: {
  record: MedicalRecord;
  onDelete?: () => void;
  className?: string;
}) {
  const Icon = ICON[record.type];
  const active = prescriptionActive(record);

  return (
    <article
      className={cn("rounded-2xl border border-mist bg-white p-4", className)}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            ACCENT[record.type]
          )}
          aria-hidden
        >
          <Icon width={17} height={17} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-ink">{record.title}</h3>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-charcoal/50">
                {formatDate(record.occurredAt)}
              </span>
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label={`Delete ${record.title}`}
                  className="text-charcoal/40 transition-colors hover:text-leash"
                >
                  <TrashIcon width={14} height={14} />
                </button>
              )}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-charcoal/45">
            {RECORD_TYPE_LABELS[record.type]}
          </p>

          {record.details && (
            <p className="mt-2 text-sm leading-relaxed text-charcoal/80">
              {record.details}
            </p>
          )}

          {record.type === "prescription" && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-fog px-3 py-2.5 text-xs sm:grid-cols-4">
              {record.medicationName && (
                <div className="col-span-2">
                  <dt className="text-charcoal/55">Medication</dt>
                  <dd className="text-ink">{record.medicationName}</dd>
                </div>
              )}
              {record.dosage && (
                <div className="col-span-2">
                  <dt className="text-charcoal/55">Dosage</dt>
                  <dd className="text-ink">{record.dosage}</dd>
                </div>
              )}
              {record.refillsLeft != null && (
                <div>
                  <dt className="text-charcoal/55">Refills</dt>
                  <dd className="font-mono text-ink">{record.refillsLeft}</dd>
                </div>
              )}
              {record.expiresAt && (
                <div>
                  <dt className="text-charcoal/55">Valid until</dt>
                  <dd className="font-mono text-ink">{formatDate(record.expiresAt)}</dd>
                </div>
              )}
              <div>
                <dt className="text-charcoal/55">Status</dt>
                <dd className={active ? "text-[#215144]" : "text-charcoal/60"}>
                  {active ? "Active" : "Expired"}
                </dd>
              </div>
            </dl>
          )}

          {record.nextDueAt && (
            <p className="mt-2 text-xs text-charcoal/65">
              Next due{" "}
              <span className="font-mono text-ink">{formatDate(record.nextDueAt)}</span>
            </p>
          )}

          {record.productSlugs.length > 0 && (
            <div className="mt-3 border-t border-mist pt-3">
              <p className="mb-1.5 text-xs text-charcoal/55">
                {active ? "Prescribed from the store" : "Recommended by your vet"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {record.productSlugs.map((slug) => (
                  <Link
                    key={slug}
                    to={`/store/${slug}`}
                    className="rounded-full border border-mist bg-white px-2.5 py-1 text-xs text-ink transition-colors hover:border-ink"
                  >
                    View in store →
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
