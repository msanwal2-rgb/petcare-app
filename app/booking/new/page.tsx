import { Suspense } from "react";
import type { Metadata } from "next";
import { BookingNewClient } from "@/components/booking/BookingNewClient";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = {
  title: "Request a booking",
};

export default function BookingNewPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="mt-6 h-80 w-full rounded-2xl" />
        </div>
      }
    >
      <BookingNewClient />
    </Suspense>
  );
}
