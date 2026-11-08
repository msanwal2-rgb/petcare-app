import { Link } from "react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { User, Booking, BookingStatus } from "@/types";
import { getCaretakerProfileForUser } from "@/api/caretakers";
import { listCaretakerBookings, updateBookingStatus } from "@/api/bookings";
import { getCaretakerStats } from "@/api/dashboard";
import { getUsersByIds } from "@/api/users";
import { useAsync } from "@/hooks/useAsync";
import { Avatar } from "@/components/Avatar";
import { ServiceTypeChip } from "@/components/ServiceTypeChip";
import { BookingListRow } from "./BookingListRow";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Skeleton } from "@/components/ui/Skeleton";
import { CalendarIcon, ClockIcon, WalletIcon } from "@/components/ui/icons";
import { startOfTodayIso } from "@/lib/calendar";
import { SERVICE_LABELS, formatCents, formatRange, formatCurrency } from "@/lib/utils";
import { ProfileStrip } from "./schedule/ProfileStrip";
import { ScheduleOverview } from "./schedule/ScheduleOverview";
import { StatCards } from "./schedule/StatCards";
import { caretakerSource } from "./schedule/sources";

const NOUN = { one: "booking", many: "bookings" };

/**
 * The caretaker's dashboard — the vet's layout (the client's call): three
 * cards, incoming requests and active bookings, the upcoming list beside an
 * interactive calendar, history, and the listing small at the foot.
 */
export function CaretakerDashboard({ user }: { user: User }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const { data: profile, loading: loadingProfile } = useAsync(
    () => getCaretakerProfileForUser(user.id),
    [user.id]
  );
  const { data, loading } = useAsync(async () => {
    if (!profile) return null;
    // The request queue and the history read the newest hundred, as before.
    // The cards and the calendar are counted and windowed by the API.
    const { items: bookings } = await listCaretakerBookings(profile.id, { limit: 100 });
    const owners = await getUsersByIds([...new Set(bookings.map((b) => b.ownerId))]);
    const map = new Map(owners.map((o) => [o.id, o]));
    return { bookings, map };
  }, [profile?.id, version]);

  const stats = useAsync(
    async () => (profile ? getCaretakerStats(profile.id, startOfTodayIso()) : null),
    [profile?.id, version],
  );

  const sources = useMemo(() => (profile ? [caretakerSource(profile.id)] : []), [profile]);

  if (loadingProfile) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  if (!profile) {
    return (
      <EmptyState
        title="Set up your caretaker profile"
        description="Add your services, pricing, and availability so owners can find and book you."
        actionLabel="Create caretaker profile"
        actionHref="/dashboard/caretaker-profile"
      />
    );
  }

  const bookings = data?.bookings ?? [];
  const requests = bookings.filter((b) => b.status === "requested");
  const active = bookings.filter((b) =>
    ["accepted", "in_progress"].includes(b.status)
  );
  const history = bookings.filter((b) =>
    ["completed", "declined", "cancelled"].includes(b.status)
  );
  const ownerName = (b: Booking) => data?.map.get(b.ownerId)?.name ?? "Owner";
  const ownerAvatar = (b: Booking) => data?.map.get(b.ownerId)?.avatarUrl;

  async function act(id: string, status: BookingStatus, msg: string) {
    setBusyId(id);
    try {
      await updateBookingStatus(id, status);
      toast.success(msg);
      refresh();
    } catch {
      toast.error("Couldn’t update. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  /** Accept and decline — the same buttons in the queue and on the calendar. */
  function answer(b: Booking) {
    if (b.status !== "requested") return null;
    return (
      <>
        <Button
          variant="cta"
          size="sm"
          onClick={() => act(b.id, "accepted", "Request accepted.")}
          disabled={busyId === b.id}
        >
          Accept
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => act(b.id, "declined", "Request declined.")}
          disabled={busyId === b.id}
        >
          Decline
        </Button>
      </>
    );
  }

  return (
    <RevealGroup className="space-y-10">
      <RevealItem>
        <StatCards
          loading={stats.loading && !stats.data}
          failed={!!stats.error}
          cards={[
            {
              label: "Total bookings",
              value: String(stats.data?.total ?? 0),
              hint: "Every booking requested of you, less declined and cancelled",
              icon: <CalendarIcon width={18} height={18} />,
            },
            {
              label: "Upcoming",
              value: String(stats.data?.upcoming ?? 0),
              hint: "Requested, accepted or under way — today or later",
              icon: <ClockIcon width={18} height={18} />,
            },
            {
              label: "Earned",
              value: formatCents(stats.data?.earnedCents ?? 0),
              hint: "Completed bookings at the price quoted — settled with the owner, not through Leash",
              icon: <WalletIcon width={18} height={18} />,
            },
          ]}
        />
      </RevealItem>

      {/* Incoming requests */}
      <RevealItem>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink">
          Incoming requests
          {requests.length > 0 && (
            <span className="rounded-full bg-leash px-2 py-0.5 font-mono text-xs text-white">
              {requests.length}
            </span>
          )}
        </h2>
        {loading && !data ? (
          <Skeleton className="h-28 w-full rounded-2xl" />
        ) : requests.length === 0 ? (
          <EmptyState
            title="No pending requests"
            description="When an owner requests a booking, it’ll appear here for you to accept or decline."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-marigold/40 bg-marigold/5 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {ownerAvatar(b) && <Avatar src={ownerAvatar(b)!} size={44} />}
                    <div>
                      <p className="font-semibold text-ink">{ownerName(b)}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-charcoal/65">
                        <ServiceTypeChip service={b.serviceType} size="sm" />
                        {b.petIds.length} pet{b.petIds.length > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-sm font-medium text-ink">
                    {formatCurrency(b.priceTotal)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-charcoal/60">
                  {formatRange(b.startDateTime, b.endDateTime)}
                </p>
                {b.notes && (
                  <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-charcoal/80">
                    “{b.notes}”
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {answer(b)}
                  <Link
                    to={`/booking/${b.id}`}
                    className="ml-1 text-sm text-charcoal/60 hover:text-ink"
                  >
                    View details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </RevealItem>

      {/* Active */}
      <RevealItem>
        <h2 className="mb-4 text-lg font-semibold text-ink">Active bookings</h2>
        {loading && !data ? (
          <Skeleton className="h-[76px] w-full rounded-[12px]" />
        ) : active.length === 0 ? (
          <EmptyState
            title="No active bookings"
            description="Accepted and in-progress bookings will appear here."
          />
        ) : (
          <div className="space-y-3">
            {active.map((b) => (
              <BookingListRow
                key={b.id}
                booking={b}
                counterpartName={ownerName(b)}
                counterpartAvatar={ownerAvatar(b)}
              />
            ))}
          </div>
        )}
      </RevealItem>

      <RevealItem>
        <ScheduleOverview
          sources={sources}
          version={version}
          availability={profile.availability}
          noun={NOUN}
          emptyUpcoming="New requests appear here as soon as they arrive."
          renderActions={(e) => (e.booking ? answer(e.booking) : null)}
        />
      </RevealItem>

      {/* History */}
      {history.length > 0 && (
        <RevealItem>
          <h2 className="mb-4 text-lg font-semibold text-ink">History</h2>
          <div className="space-y-3">
            {history.map((b) => (
              <BookingListRow
                key={b.id}
                booking={b}
                counterpartName={ownerName(b)}
                counterpartAvatar={ownerAvatar(b)}
              />
            ))}
          </div>
        </RevealItem>
      )}

      <RevealItem>
        <ProfileStrip
          label="Your listing"
          name={user.name}
          place={[user.address.city, user.address.state].filter(Boolean).join(", ")}
          tags={profile.servicesOffered.map((s) => SERVICE_LABELS[s])}
          facts={[`${profile.serviceRadiusMiles} mi radius`]}
          editHref="/dashboard/caretaker-profile"
        />
      </RevealItem>
    </RevealGroup>
  );
}
