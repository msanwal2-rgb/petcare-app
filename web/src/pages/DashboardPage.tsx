import { useSession } from "@/store/session";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { RoleToggle } from "@/components/RoleToggle";
import { ROLE_LABELS, STAFF_ROLE_LABELS, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/Avatar";
import { ButtonLink } from "@/components/ui/Button";

/**
 * The dashboard, in its M1 form.
 *
 * The role-aware dashboard proper — owner bookings, caretaker requests, the vet
 * schedule — needs M3 through M5. What it shows now is exactly what M1 knows:
 * who you are, what the session says about you, and the verification nudge. It
 * exists so the auth flows have somewhere real to land.
 *
 * Rendered inside RequireAuth, so `currentUser` is non-null here.
 */
export default function DashboardPage() {
  const { currentUser, activeRole } = useSession();
  const user = currentUser!;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <VerifyEmailBanner />

      <div className="flex items-center gap-4">
        <Avatar src={user.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-ink">{user.name}</h1>
          <p className="text-sm text-charcoal/60">{user.email}</p>
        </div>
        <RoleToggle />
      </div>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <Row label="Active role" value={ROLE_LABELS[activeRole]} />
        <Row
          label="Roles"
          value={user.roles.map((r) => ROLE_LABELS[r]).join(", ") || "None chosen yet"}
        />
        <Row label="Email verified" value={user.verified ? "Yes" : "Not yet"} />
        <Row label="Member since" value={formatDate(user.createdAt)} />
        <Row
          label="Location"
          value={`${user.address.city}, ${user.address.state}`}
        />
        {user.staffRoles.length > 0 && (
          <Row
            label="Staff"
            value={user.staffRoles.map((r) => STAFF_ROLE_LABELS[r]).join(", ")}
          />
        )}
      </dl>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-mist bg-white p-5">
        <div>
          <h2 className="font-medium text-ink">Your pets</h2>
          <p className="mt-0.5 text-sm text-charcoal/60">
            Profiles, health records and what the store suggests for each animal.
          </p>
        </div>
        <ButtonLink to="/dashboard/pets" variant="outline" size="sm">
          Open
        </ButtonLink>
      </div>

      <p className="mt-4 rounded-xl border border-dashed border-mist bg-white/60 p-5 text-sm text-charcoal/65">
        Bookings, appointments and orders arrive with M4–M6. The role-aware
        dashboard proper needs them.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-mist bg-white p-4">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
