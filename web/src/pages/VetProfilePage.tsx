import { useEffect, useState, type FormEvent } from "react";
import type {
  ConsultMode,
  Species,
  VetAppointment,
  VetProfile,
  VetSpecialty,
} from "@/types";
import { getVetProfileForUser, saveVetProfile } from "@/api/vets";
import { listVetAppointments } from "@/api/appointments";
import { ApiError } from "@/api/_client";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useSession } from "@/store/session";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONE,
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  SPECIES_LABELS,
  formatCurrency,
  formatDateTime,
} from "@/lib/utils";

/**
 * The vet's own side: the listing they publish, the fee that prices every
 * consultation, and the schedule waiting on them.
 *
 * ── Four fields are missing from this form on purpose ──
 *
 * Rating, review count and response rate are derived from what the clinic has
 * actually done. And **`verificationStatus` is set by staff, never here**
 * (REQUIREMENTS.md V11) — it is shown, with a line saying who grants it. A
 * licence badge its holder can award themselves tells an owner nothing, which
 * is the entire reason for having one. The API has nowhere to put any of the
 * four either, so this is a matter of shape rather than of a check.
 */
export default function VetProfilePage() {
  const { currentUser } = useSession();
  const userId = currentUser!.id;

  const [profile, setProfile] = useState<VetProfile | null | undefined>(undefined);
  const [queue, setQueue] = useState<VetAppointment[]>([]);

  useEffect(() => {
    getVetProfileForUser(userId).then(setProfile).catch(() => setProfile(null));
  }, [userId]);

  useEffect(() => {
    if (!profile) return;
    listVetAppointments(profile.id, { limit: 10 })
      .then((page) => setQueue(page.items))
      .catch(() => setQueue([]));
  }, [profile]);

  if (profile === undefined) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Your clinic listing</h1>
        <p className="mt-1 text-sm text-charcoal/60">
          {profile === null
            ? "You don't have a listing yet. Filling this in publishes one."
            : "What owners see when they find you in search."}
        </p>
      </div>

      {profile && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Derived label="Rating" value={`${profile.rating.toFixed(1)} ★`} />
            <Derived label="Reviews" value={String(profile.reviewCount)} />
            <Derived label="Response rate" value={`${profile.responseRatePct}%`} />
          </section>

          <section className="rounded-2xl border border-mist bg-white p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
              Licence
            </p>
            <p className="mt-1 text-sm text-ink">
              {profile.verificationStatus === "verified"
                ? "Verified"
                : profile.verificationStatus === "pending"
                  ? "Being checked"
                  : "Not yet checked"}
            </p>
            <p className="mt-1.5 text-xs text-charcoal/55">
              Set by the Leash team, not here. A badge you could grant yourself
              would tell an owner nothing.
            </p>
          </section>
        </>
      )}

      <ProfileForm profile={profile} userId={userId} onSaved={setProfile} />

      {profile && (
        <section className="rounded-2xl border border-mist bg-white p-6">
          <h2 className="text-lg font-semibold text-ink">Schedule</h2>
          <p className="mt-1 text-sm text-charcoal/60">
            Answering requests — either way — is what moves your response rate.
            Open a visit to start it and write the summary.
          </p>

          {queue.length === 0 ? (
            <p className="mt-4 text-sm text-charcoal/60">Nothing waiting on you.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {queue.map((appointment) => (
                <li key={appointment.id}>
                  <ButtonLink
                    to={`/appointment/${appointment.id}`}
                    variant="outline"
                    className="flex w-full items-center justify-between gap-3 !rounded-xl !px-4 !py-3"
                  >
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm text-ink">
                        {CONSULT_MODE_LABELS[appointment.mode]} ·{" "}
                        {appointment.reason}
                      </span>
                      <span className="block truncate text-xs text-charcoal/55">
                        {formatDateTime(appointment.startDateTime)} ·{" "}
                        {formatCurrency(appointment.fee)}
                      </span>
                    </span>
                    <StatusBadge
                      tone={APPOINTMENT_STATUS_TONE[appointment.status]}
                      label={APPOINTMENT_STATUS_LABELS[appointment.status]}
                    />
                  </ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function ProfileForm({
  profile,
  userId,
  onSaved,
}: {
  profile: VetProfile | null;
  userId: string;
  onSaved: (profile: VetProfile) => void;
}) {
  const [clinicName, setClinicName] = useState(profile?.clinicName ?? "");
  const [city, setCity] = useState(profile?.clinic.city ?? "");
  const [state, setState] = useState(profile?.clinic.state ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [licenseNumber, setLicenseNumber] = useState(profile?.licenseNumber ?? "");
  const [licenseState, setLicenseState] = useState(profile?.licenseState ?? "");
  const [years, setYears] = useState(profile?.yearsExperience ?? 0);
  const [consultFee, setConsultFee] = useState(profile?.consultFee ?? 0);
  const [emergency, setEmergency] = useState(profile?.emergencyAvailable ?? false);
  const [specialties, setSpecialties] = useState<VetSpecialty[]>(
    profile?.specialties ?? [],
  );
  const [species, setSpecies] = useState<Species[]>(profile?.acceptedSpecies ?? []);
  const [modes, setModes] = useState<ConsultMode[]>(profile?.consultModes ?? []);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    setIssues({});

    try {
      onSaved(
        await saveVetProfile(userId, {
          bio,
          specialties,
          licenseNumber,
          licenseState,
          yearsExperience: years,
          acceptedSpecies: species,
          consultModes: modes,
          consultFee,
          emergencyAvailable: emergency,
          // Sent whole: the five columns behind it move together, and a patch
          // that named only the city would leave the coordinates pointing at
          // the old address.
          clinic: {
            name: clinicName,
            city,
            state,
            lat: profile?.clinic.lat ?? 0,
            lng: profile?.clinic.lng ?? 0,
          },
        }),
      );
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border border-mist bg-white p-6"
      noValidate
    >
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
        >
          {error}
        </p>
      )}

      <Field label="Clinic name" htmlFor="clinicName" error={issues["clinic.name"]}>
        <Input
          id="clinicName"
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          placeholder="South Austin Animal Hospital"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="City" htmlFor="city">
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="State" htmlFor="state">
          <Input id="state" value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
      </div>

      <Field label="About your practice" htmlFor="bio" error={issues.bio}>
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="General practice with a particular interest in nutrition."
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Licence number"
          htmlFor="licenseNumber"
          error={issues.licenseNumber}
        >
          <Input
            id="licenseNumber"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            placeholder="TX-VM-44219"
          />
        </Field>
        <Field label="Licensed in" htmlFor="licenseState">
          <Input
            id="licenseState"
            value={licenseState}
            onChange={(e) => setLicenseState(e.target.value)}
            placeholder="TX"
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Years in practice" htmlFor="years" error={issues.yearsExperience}>
          <Input
            id="years"
            type="number"
            min={0}
            max={70}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
          />
        </Field>

        <Field
          label="Consultation fee"
          hint="USD"
          htmlFor="consultFee"
          error={issues.consultFee}
        >
          <Input
            id="consultFee"
            type="number"
            min={0}
            step={1}
            value={consultFee}
            onChange={(e) => setConsultFee(Number(e.target.value))}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Specialties</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SPECIALTY_LABELS) as VetSpecialty[]).map((s) => (
            <Toggle
              key={s}
              label={SPECIALTY_LABELS[s]}
              checked={specialties.includes(s)}
              onChange={(on) =>
                setSpecialties((current) =>
                  on ? [...current, s] : current.filter((x) => x !== s),
                )
              }
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Animals you treat</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SPECIES_LABELS) as Species[]).map((s) => (
            <Toggle
              key={s}
              label={SPECIES_LABELS[s]}
              checked={species.includes(s)}
              onChange={(on) =>
                setSpecies((current) =>
                  on ? [...current, s] : current.filter((x) => x !== s),
                )
              }
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">
          Consultations you offer
        </legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CONSULT_MODE_LABELS) as ConsultMode[]).map((m) => (
            <Toggle
              key={m}
              label={CONSULT_MODE_LABELS[m]}
              checked={modes.includes(m)}
              onChange={(on) =>
                setModes((current) =>
                  on ? [...current, m] : current.filter((x) => x !== m),
                )
              }
            />
          ))}
        </div>
      </fieldset>

      <Toggle
        label="Emergency cover"
        checked={emergency}
        onChange={setEmergency}
      />

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" variant="cta" disabled={saving}>
          {saving ? "Saving…" : profile ? "Save listing" : "Publish listing"}
        </Button>
        {saved && <span className="text-sm text-charcoal/60">Saved.</span>}
      </div>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-mist px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-ink">{label}</span>
    </label>
  );
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-mist bg-white p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
