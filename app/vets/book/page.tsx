import { Suspense } from "react";
import type { Metadata } from "next";
import { AppointmentBookingClient } from "@/components/vet/AppointmentBookingClient";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = {
  title: "Request an appointment",
};

export default function BookAppointmentPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
        </div>
      }
    >
      <AppointmentBookingClient />
    </Suspense>
  );
}
