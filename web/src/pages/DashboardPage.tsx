import { useSession } from "@/store/session";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { RoleToggle } from "@/components/RoleToggle";
import { ROLE_LABELS, STAFF_ROLE_LABELS, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/Avatar";
import { ButtonLink } from "@/components/ui/Button";

/**
 * The dashboard: who you are, and a way into every area built so far.
 *
 * Still the simple version. The reference project's dashboard is role-aware —
 * `components/dashboard/{Owner,Caretaker,Vet}Dashboard.tsx`, with upcoming
 * bookings, requests waiting on you and the day's schedule inline — and that is
 * part of the UI alignment pass (BUILD_PLAN.md §0), not yet ported.
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

      <div className="mt-10 space-y-3">
        <Panel
          title="Your pets"
          description="Profiles, health records and what the store suggests for each animal."
          to="/dashboard/pets"
        />
        <Panel
          title="Your bookings"
          description="Requests, confirmed visits and everything already done."
          to="/dashboard/bookings"
        />
        {/* Shown to everyone rather than gated on the caretaker role: the page
            creates a listing for someone who has none, which is how a customer
            becomes a caretaker in the first place. */}
        <Panel
          title="Your vet visits"
          description="Appointments you've booked, and the visit summaries they produced."
          to="/dashboard/appointments"
        />
        <Panel
          title="Your orders"
          description="Track a parcel, or cancel before it ships."
          to="/store/orders"
        />
        <Panel
          title="Your caretaker listing"
          description="What owners see in search, and the rate card that prices your bookings."
          to="/dashboard/caretaker-profile"
        />
        {/* Shown to everyone, for the same reason as the caretaker listing:
            filling it in is how somebody becomes a vet on Leash. */}
        <Panel
          title="Your clinic listing"
          description="Your profile, consultation fee, and the schedule of visits waiting on you."
          to="/dashboard/vet-profile"
        />
        {/* Only offered to staff who can use it. The API refuses everyone else
            regardless — this just keeps a dead end off customers' dashboards. */}
        {user.staffRoles.some((r) => r === "ops" || r === "admin") && (
          <Panel
            title="Fulfilment queue"
            description="Paid orders on their way out, oldest first."
            to="/dashboard/orders"
          />
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-mist bg-white p-5">
      <div className="min-w-0">
        <h2 className="font-medium text-ink">{title}</h2>
        <p className="mt-0.5 text-sm text-charcoal/60">{description}</p>
      </div>
      <ButtonLink to={to} variant="outline" size="sm">
        Open
      </ButtonLink>
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
