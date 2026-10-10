import { AppointmentBookingClient } from "@/components/vet/AppointmentBookingClient";

/**
 * Request an appointment — the reference's `app/vets/book/page.tsx`, at
 * `/vets/book`. Its `Suspense` boundary existed for Next's `useSearchParams`.
 */
export default function AppointmentNewPage() {
  return <AppointmentBookingClient />;
}
