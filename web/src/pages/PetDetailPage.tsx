import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { MedicalRecord, Pet, Product } from "@/types";
import {
  deletePet,
  getPetById,
  getPetRecommendations,
  getPetRecords,
  updatePet,
} from "@/api/pets";
import { ApiError } from "@/api/_client";
import { PetForm } from "@/components/PetForm";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSession } from "@/store/session";
import {
  RECORD_TYPE_LABELS,
  SPECIES_LABELS,
  formatCents,
  formatDate,
  petAge,
} from "@/lib/utils";

/**
 * One animal: its profile, its health timeline, and what the store suggests
 * for it.
 *
 * Three panels because they answer to three different authorization rules, and
 * the page is honest about which one you failed:
 *
 *  - the **profile** is visible to the owner, a sitter with a booking, or a
 *    treating vet;
 *  - the **health timeline** is the owner and the treating vet only — a booking
 *    is not clinical access;
 *  - **recommendations** are owner-only, because the shelf is a readout of the
 *    animal's allergy list.
 *
 * A sitter therefore sees the pet and an explanatory note where the records
 * would be, rather than an empty panel that looks broken.
 */
export default function PetDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useSession();

  const [pet, setPet] = useState<Pet | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    getPetById(id).then(setPet).catch(() => setPet(null));
  }, [id]);

  useEffect(load, [load]);

  if (pet === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (pet === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Pet not found</h1>
        <p className="mt-2 text-sm text-charcoal/60">
          It may have been removed, or it may not be yours to see.
        </p>
        <ButtonLink to="/dashboard/pets" variant="outline" className="mt-6">
          Back to your pets
        </ButtonLink>
      </div>
    );
  }

  const isOwner = currentUser?.id === pet.ownerId;

  if (editing) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="mb-8 text-2xl font-semibold text-ink">Edit {pet.name}</h1>
        <PetForm
          initial={pet}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const updated = await updatePet(pet.id, input);
            setPet(updated);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <ProfilePanel
        pet={pet}
        isOwner={isOwner}
        onEdit={() => setEditing(true)}
        onDeleted={() => navigate("/dashboard/pets", { replace: true })}
      />
      <RecordsPanel petId={pet.id} />
      {isOwner && <RecommendationsPanel petId={pet.id} petName={pet.name} />}
    </div>
  );
}

function ProfilePanel({
  pet,
  isOwner,
  onEdit,
  onDeleted,
}: {
  pet: Pet;
  isOwner: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deletePet(pet.id);
      onDeleted();
    } catch (err) {
      // A 409 here is the guard against cascading away records the owner did
      // not author. The server's message explains it; show that rather than a
      // generic failure.
      setDeleteError(
        err instanceof ApiError ? err.message : "Could not remove this pet",
      );
      setConfirming(false);
    }
  }

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <div className="flex flex-wrap items-start gap-5">
        <img
          src={pet.photoUrl}
          alt=""
          width={96}
          height={96}
          className="size-24 shrink-0 rounded-2xl bg-mist object-cover"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-ink">{pet.name}</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            {SPECIES_LABELS[pet.species]} · {pet.breed} · {pet.sex} · {petAge(pet)} ·{" "}
            {pet.weightLbs} lb
          </p>
          <p className="mt-1 text-sm text-charcoal/60">
            {pet.vaccinated ? "Vaccinated" : "Not vaccinated"} · Vet:{" "}
            {pet.vetContact.name} ({pet.vetContact.phone})
          </p>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (confirming ? handleDelete() : setConfirming(true))}
            >
              {confirming ? "Really remove?" : "Remove"}
            </Button>
          </div>
        )}
      </div>

      {deleteError && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
        >
          {deleteError}
        </p>
      )}

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <Detail label="Allergies" value={pet.allergies.join(", ") || "None recorded"} />
        <Detail
          label="Medications"
          value={pet.medications.join(", ") || "None recorded"}
        />
        <Detail label="Feeding" value={pet.feedingInstructions || "—"} />
        <Detail label="Behaviour" value={pet.behaviorNotes || "—"} />
      </dl>
    </section>
  );
}

function RecordsPanel({ petId }: { petId: string }) {
  const [records, setRecords] = useState<MedicalRecord[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    getPetRecords(petId)
      .then(setRecords)
      .catch((e: unknown) => {
        // 403 is the expected answer for a sitter, not a failure to report as
        // one. A booking lets you walk the dog; it does not open the file.
        if (e instanceof ApiError && e.status === 403) setForbidden(true);
        else setRecords([]);
      });
  }, [petId]);

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <h2 className="text-lg font-semibold text-ink">Health record</h2>

      {forbidden && (
        <p className="mt-4 rounded-xl border border-dashed border-mist bg-white/60 p-5 text-sm text-charcoal/65">
          The health record is visible to this pet's owner and the vets treating
          it. Looking after an animal does not open its clinical history.
        </p>
      )}

      {!forbidden && records === null && (
        <Skeleton className="mt-4 h-24 rounded-xl" />
      )}

      {!forbidden && records?.length === 0 && (
        <p className="mt-4 text-sm text-charcoal/60">
          Nothing recorded yet. Vaccinations, visit notes and prescriptions land
          here after a vet visit.
        </p>
      )}

      {!forbidden && records && records.length > 0 && (
        <ol className="mt-5 space-y-4">
          {records.map((record) => (
            <li
              key={record.id}
              className="border-l-2 border-mist pl-4 first:border-leash"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
                  {RECORD_TYPE_LABELS[record.type]}
                </span>
                <span className="text-xs text-charcoal/50">
                  {formatDate(record.occurredAt)}
                </span>
              </div>
              <p className="mt-1 font-medium text-ink">{record.title}</p>
              {record.details && (
                <p className="mt-1 text-sm text-charcoal/70">{record.details}</p>
              )}

              {record.type === "prescription" && (
                <p className="mt-2 rounded-lg bg-mist/40 px-3 py-2 text-xs text-charcoal/70">
                  {record.medicationName}
                  {record.dosage && ` — ${record.dosage}`}
                  {record.expiresAt && ` · valid until ${formatDate(record.expiresAt)}`}
                  {record.refillsLeft !== null &&
                    ` · ${record.refillsLeft} refill${record.refillsLeft === 1 ? "" : "s"} left`}
                </p>
              )}

              {record.nextDueAt && (
                <p className="mt-1.5 text-xs text-leash">
                  Next due {formatDate(record.nextDueAt)}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecommendationsPanel({
  petId,
  petName,
}: {
  petId: string;
  petName: string;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    getPetRecommendations(petId)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [petId]);

  if (products !== null && products.length === 0) return null;

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <h2 className="text-lg font-semibold text-ink">Suited to {petName}</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        Right species and life stage, and nothing listing an ingredient{" "}
        {petName} reacts to.
      </p>

      {products === null ? (
        <Skeleton className="mt-5 h-28 rounded-xl" />
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {products.map((product) => (
            <li
              key={product.id}
              className="flex items-center gap-3 rounded-xl border border-mist p-3"
            >
              <img
                src={product.imageUrl}
                alt=""
                width={48}
                height={48}
                className="size-12 shrink-0 rounded-lg bg-mist object-cover"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {product.name}
                </p>
                <p className="text-xs text-charcoal/60">
                  {product.brand} · {formatCents(product.priceCents)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
