"use client";

/**
 * The "I'm looking that up" affordance.
 *
 * Two reasons this exists rather than letting tool calls happen invisibly.
 * A support answer that takes six seconds with no sign of life reads as broken.
 * And showing *what* was consulted is the honest version of a bot that claims
 * to have checked your order: the customer can see that it did.
 *
 * In flight it borrows the dashed leash line, this product's signature motif.
 * Settled, it collapses to one monospace line, the same treatment notification
 * timestamps get.
 */

import { motion } from "framer-motion";
import { DURATION, EASE_OUT } from "@/lib/motion";

/** Present and past tense per tool, so the line reads naturally either way. */
const TOOL_LABELS: Record<string, [doing: string, done: string]> = {
  getMyOrders: ["Checking your orders", "Checked your orders"],
  getOrder: ["Opening your order", "Read your order"],
  getMyBookings: ["Checking your bookings", "Checked your bookings"],
  getBooking: ["Opening your booking", "Read your booking"],
  getMyAppointments: ["Checking your appointments", "Checked your appointments"],
  getAppointment: ["Opening your appointment", "Read your appointment"],
  getMyPets: ["Looking up your pets", "Found your pets"],
  getPetHealthRecord: ["Reading the health record", "Read the health record"],
  getActivePrescriptions: ["Checking prescriptions", "Checked prescriptions"],
  getMyNotifications: ["Checking notifications", "Checked notifications"],
  searchProducts: ["Searching the store", "Searched the store"],
  getProduct: ["Looking up the product", "Found the product"],
  recommendProductsForPet: ["Finding suitable food", "Found suitable food"],
  searchCaretakers: ["Searching caretakers", "Searched caretakers"],
  searchVets: ["Searching vets", "Searched vets"],
  searchKnowledge: ["Looking up our policies", "Read our policies"],
  getStoreFacts: ["Checking shipping rules", "Checked shipping rules"],
  cancelOrder: ["Cancelling your order", "Cancelled your order"],
  cancelBooking: ["Cancelling your booking", "Cancelled your booking"],
  cancelAppointment: ["Cancelling your appointment", "Cancelled your appointment"],
  markNotificationsRead: ["Marking as read", "Marked as read"],
  addToCart: ["Adding to your cart", "Added to your cart"],
  openPage: ["Finding the page", "Found the page"],
  startCheckout: ["Opening checkout", "Opened checkout"],
  startCaretakerBooking: ["Preparing the booking form", "Prepared the booking form"],
  startVetAppointment: ["Preparing the appointment form", "Prepared the appointment form"],
  offerSignIn: ["Preparing a sign-in link", "Prepared a sign-in link"],
};

function labelFor(toolName: string, done: boolean): string {
  const pair = TOOL_LABELS[toolName];
  if (pair) return done ? pair[1] : pair[0];
  // An unmapped tool should still read as English rather than as camelCase.
  const words = toolName.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return done ? `Checked ${words}` : `Checking ${words}`;
}

export function ToolActivity({
  toolName,
  done,
  failed,
}: {
  toolName: string;
  done: boolean;
  failed?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 py-0.5 font-mono text-[10px] text-charcoal/45"
      data-testid="assistant-tool-activity"
      aria-live="polite"
    >
      {done ? (
        <span aria-hidden className="h-px w-4 bg-mist" />
      ) : (
        <span aria-hidden className="relative h-px w-4 overflow-hidden">
          {/* The leash line, drawing itself along. */}
          <motion.span
            className="absolute inset-y-0 left-0 w-2 bg-ink/60"
            animate={{ x: [0, 8, 0] }}
            transition={{
              duration: 1.1,
              ease: EASE_OUT,
              repeat: Infinity,
            }}
          />
        </span>
      )}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      >
        {failed ? `Couldn't ${labelFor(toolName, false).toLowerCase()}` : labelFor(toolName, done)}
        {!done && !failed ? "…" : ""}
      </motion.span>
    </div>
  );
}
