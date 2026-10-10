import { BookingNewClient } from "@/components/booking/BookingNewClient";

/**
 * Request a booking — the reference's `app/booking/new/page.tsx`. Its
 * `Suspense` boundary existed for Next's `useSearchParams`; React Router
 * needs none.
 */
export default function BookingNewPage() {
  return <BookingNewClient />;
}
