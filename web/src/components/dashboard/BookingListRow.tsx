import { Link } from "react-router";
import type { Booking } from "@/types";
import { Avatar } from "@/components/Avatar";
import { BookingStatusBadge } from "@/components/BookingStatusBadge";
import { ServiceTypeChip } from "@/components/ServiceTypeChip";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatRange, formatCurrency } from "@/lib/utils";

export function BookingListRow({
  booking,
  counterpartName,
  counterpartAvatar,
}: {
  booking: Booking;
  counterpartName: string;
  counterpartAvatar?: string;
}) {
  return (
    <Link
      to={`/booking/${booking.id}`}
      className="group flex items-center gap-4 rounded-[12px] border border-mist bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      {counterpartAvatar && <Avatar src={counterpartAvatar} size={44} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-ink">{counterpartName}</p>
          <ServiceTypeChip service={booking.serviceType} size="sm" />
        </div>
        <p className="mt-0.5 truncate text-xs text-charcoal/60">
          {formatRange(booking.startDateTime, booking.endDateTime)}
        </p>
      </div>
      <div className="hidden text-right sm:block">
        <p className="font-mono text-sm font-medium text-ink">
          {formatCurrency(booking.priceTotal)}
        </p>
      </div>
      <BookingStatusBadge status={booking.status} />
      <ChevronRightIcon
        width={18}
        height={18}
        className="shrink-0 text-charcoal/30 transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
