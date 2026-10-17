import { Link, useNavigate, useParams } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { HomeType } from "@/types";
import { applyToAdopt, getListingById } from "@/api/adoptions";
import { ApiError } from "@/api/_client";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { BLUR_DATA_URL } from "@/lib/photos";
import { formatCents, formatDate, petAge } from "@/lib/utils";

/**
 * One animal, and the form to ask for them — the reference's `app/adopt/[id]/page.tsx`.
 *
 * The temperament answers are shown as they are, `unknown` included. A shelter
 * that has not tested a dog around cats should be able to say so rather than
 * pick the answer that sells.
 */
const TRI_LABEL = { yes: "Yes", no: "No", unknown: "Not known" } as const;

export default function AdoptionListingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { currentUser, hasHydrated } = useSession();
  const [applying, setApplying] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [householdAdults, setHouseholdAdults] = useState("2");
  const [householdChildren, setHouseholdChildren] = useState("0");
  const [homeType, setHomeType] = useState<HomeType>("house");
  const [fencedYard, setFencedYard] = useState(false);
  const [ownsHome, setOwnsHome] = useState(false);
  const [hasOtherPets, setHasOtherPets] = useState(false);
  const [otherPetsNotes, setOtherPetsNotes] = useState("");
  const [hoursAlonePerDay, setHoursAlonePerDay] = useState("4");
  const [experience, setExperience] = useState("");
  const [message, setMessage] = useState("");

  const { data, loading } = useAsync(() => getListingById(id), [id]);

  if (!hasHydrated || loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="This animal isn't listed"
          description="They may have been adopted. There are others waiting."
          actionLabel="Browse adoptions"
          actionHref="/adopt"
        />
      </div>
    );
  }

  const { listing, pet, shelterName } = data;
  const available = listing.status === "available";

  async function submit() {
    setApplying(true);
    try {
      const application = await applyToAdopt({
        listingId: id,
        householdAdults: Number(householdAdults),
        householdChildren: Number(householdChildren),
        hasOtherPets,
        otherPetsNotes,
        homeType,
        fencedYard,
        ownsHome,
        hoursAlonePerDay: Number(hoursAlonePerDay),
        experience,
        message,
      });
      toast.success("Application sent", { description: `${shelterName} will be in touch.` });
      navigate(`/adoptions/${application.id}`);
    } catch (e) {
      toast.error("Couldn't send that", {
        description: e instanceof ApiError ? e.message : "Please try again in a moment.",
      });
      setApplying(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link to="/adopt" className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline">
        ← All animals
      </Link>

      <div className="mt-4 overflow-hidden rounded-3xl border border-mist bg-white">
        <div
          className="relative aspect-[16/9] bg-fog"
          style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
        >
          {pet.photoUrl && (
            <img src={pet.photoUrl} alt={pet.name} className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>

        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-ink">{pet.name}</h1>
              <p className="mt-1 text-charcoal/70">
                {pet.breed} · {petAge(pet)} · {pet.sex === "male" ? "Male" : "Female"}
              </p>
              <p className="mt-1 font-mono text-xs text-charcoal/55">
                {listing.location.city}, {listing.location.state} · with{" "}
                <Link to={`/shelters/${listing.shelterId}`} className="hover:underline">
                  {shelterName}
                </Link>{" "}
                since {formatDate(listing.intakeAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-2xl font-semibold text-ink">
                {listing.feeCents === 0 ? "No fee" : formatCents(listing.feeCents)}
              </p>
              <p className="text-xs text-charcoal/55">adoption fee</p>
            </div>
          </div>

          {listing.headline && <p className="mt-4 text-lg text-ink">{listing.headline}</p>}
          {listing.story && <p className="mt-3 whitespace-pre-line text-charcoal/80">{listing.story}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            {listing.specialNeeds && <StatusBadge tone="pending" label="Special needs" />}
            {listing.spayedNeutered && <StatusBadge tone="done" label="Neutered" />}
            {listing.microchipped && <StatusBadge tone="done" label="Microchipped" />}
            {pet.vaccinated && <StatusBadge tone="done" label="Vaccinated" />}
          </div>

          {listing.specialNeedsNotes && (
            <p className="mt-4 rounded-xl border border-marigold/40 bg-marigold/10 px-4 py-3 text-sm text-charcoal">
              {listing.specialNeedsNotes}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Panel title="Living with them">
          <dl className="space-y-2 text-sm">
            {[
              ["Good with children", TRI_LABEL[listing.goodWithKids]],
              ["Good with dogs", TRI_LABEL[listing.goodWithDogs]],
              ["Good with cats", TRI_LABEL[listing.goodWithCats]],
              ["House trained", TRI_LABEL[listing.houseTrained]],
              ["Energy", listing.energyLevel],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-charcoal/70">{label}</dt>
                <dd className="capitalize text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="What comes with them">
          <p className="text-sm text-charcoal/70">
            {pet.name}&apos;s health record moves across when the adoption
            completes — vaccinations, allergies, medications and every note a
            vet has written. Their new vet reads the same record.
          </p>
          {pet.allergies.length > 0 && (
            <p className="mt-3 text-sm text-charcoal/80">
              <strong className="font-medium text-ink">Allergies:</strong> {pet.allergies.join(", ")}
            </p>
          )}
          {pet.medications.length > 0 && (
            <p className="mt-1 text-sm text-charcoal/80">
              <strong className="font-medium text-ink">Medication:</strong> {pet.medications.join(", ")}
            </p>
          )}
        </Panel>
      </div>

      {pet.behaviorNotes && (
        <Panel title="What they're like" className="mt-4">
          <p className="whitespace-pre-line text-sm text-charcoal/80">{pet.behaviorNotes}</p>
        </Panel>
      )}

      <div className="mt-6">
        {!available ? (
          <EmptyState
            title={
              listing.status === "adopted"
                ? `${pet.name} has been adopted`
                : `${pet.name} isn't available just now`
            }
            description="There are other animals waiting."
            actionLabel="Browse adoptions"
            actionHref="/adopt"
          />
        ) : !currentUser ? (
          <AuthRequired message={`Log in to apply to adopt ${pet.name}.`} callbackPath={`/adopt/${id}`} />
        ) : !showForm ? (
          <Button variant="cta" size="lg" onClick={() => setShowForm(true)}>
            Apply to adopt {pet.name}
          </Button>
        ) : (
          <Panel title={`Your application for ${pet.name}`}>
            <p className="mb-4 text-sm text-charcoal/70">
              {shelterName} reads every one of these. Be honest about the hours
              and the other animals — it is how they place an animal well, not a
              test to pass.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Adults in the household" htmlFor="adults">
                <Input
                  id="adults"
                  inputMode="numeric"
                  value={householdAdults}
                  onChange={(e) => setHouseholdAdults(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Children" htmlFor="children">
                <Input
                  id="children"
                  inputMode="numeric"
                  value={householdChildren}
                  onChange={(e) => setHouseholdChildren(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Home" htmlFor="home-type">
                <Select id="home-type" value={homeType} onChange={(e) => setHomeType(e.target.value as HomeType)}>
                  <option value="house">House</option>
                  <option value="apartment">Apartment</option>
                  <option value="condo">Condo</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field
                label="Hours alone on a typical day"
                htmlFor="hours"
                hint="An honest number helps them match the animal."
              >
                <Input
                  id="hours"
                  inputMode="numeric"
                  value={hoursAlonePerDay}
                  onChange={(e) => setHoursAlonePerDay(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>

            <div className="mt-4 space-y-2">
              {[
                ["I have a fenced yard", fencedYard, setFencedYard] as const,
                ["I own my home", ownsHome, setOwnsHome] as const,
                ["I have other pets", hasOtherPets, setHasOtherPets] as const,
              ].map(([label, value, set]) => (
                <label key={label} className="flex cursor-pointer items-center gap-2 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => set(e.target.checked)}
                    className="h-4 w-4 accent-ink"
                  />
                  {label}
                </label>
              ))}
            </div>

            {hasOtherPets && (
              <Field label="Tell them about your other animals" htmlFor="other-pets" className="mt-4">
                <Textarea
                  id="other-pets"
                  rows={2}
                  value={otherPetsNotes}
                  onChange={(e) => setOtherPetsNotes(e.target.value)}
                  placeholder="Species, ages, how they are with newcomers."
                />
              </Field>
            )}

            <Field label="Your experience with animals" htmlFor="experience" className="mt-4">
              <Textarea id="experience" rows={3} value={experience} onChange={(e) => setExperience(e.target.value)} />
            </Field>

            <Field label={`Anything you'd like to say about ${pet.name}`} htmlFor="message" className="mt-4">
              <Textarea id="message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-mist pt-6">
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button variant="cta" onClick={submit} disabled={applying}>
                {applying ? "Sending…" : "Send application"}
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
