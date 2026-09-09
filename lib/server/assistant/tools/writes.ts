/**
 * Write tools: the short list of things the assistant may actually do.
 *
 * Everything here is a cancellation or a read-receipt — reversible, or
 * inconsequential. Creating a booking, an appointment or an order is
 * deliberately absent; those are links (../links.ts), not tools.
 *
 * Two rules hold across the file:
 *
 * 1. **`confirm: true` is required.** It forces the model to emit an explicit
 *    affirmative before anything destructive fires, and makes "the model
 *    half-called it" unrepresentable rather than merely unlikely.
 *
 * 2. **The domain function's own result is returned verbatim.** These functions
 *    already answer with discriminated unions — `{ok:false, code:"invalid_transition"}`
 *    and the like — and the system prompt requires the assistant to relay what
 *    it got. Rewriting a refusal into prose here would be the assistant's most
 *    plausible route to claiming something happened that did not.
 */

import { tool } from "ai";
import { z } from "zod";
import type { AssistantContext } from "../context";
import {
  appointmentActor,
  assertAppointmentParticipant,
  assertBookingParticipant,
  assertOwnsOrder,
  refuse,
  requireSignedIn,
} from "../guards";
import { presentAppointment, presentBooking, presentOrder } from "../present";
import { getOrderById, updateOrderStatus } from "@/lib/server/orders";
import { updateBookingStatus } from "@/lib/server/bookings";
import { getAppointmentById, updateAppointmentStatus } from "@/lib/server/appointments";
import { markRead } from "@/lib/server/notifications";
import { canCustomerCancel } from "@/lib/delivery";
import { ORDER_STATUS_LABELS } from "@/lib/utils";

/**
 * The confirmation gate, shared by every destructive tool. A literal `true`
 * rather than a boolean: `confirm: false` should not typecheck as a call.
 */
const confirm = z
  .literal(true)
  .describe(
    "Set only after the customer has explicitly agreed to this specific action in the conversation.",
  );

export function writeTools(ctx: AssistantContext) {
  return {
    cancelOrder: tool({
      description:
        "Cancel one of the customer's orders. Only possible before it ships. Ask them to confirm first, naming the order, then call this with confirm:true.",
      inputSchema: z.object({
        orderId: z.string(),
        confirm,
      }),
      execute: async ({ orderId }) => {
        const uid = await assertOwnsOrder(ctx, orderId);
        if (typeof uid !== "string") return uid;

        const order = await getOrderById(orderId, ctx.db);
        if (!order) return refuse("not_found");

        // Checked here as well as in the status machine so the refusal can name
        // the stage the order actually reached, which is what the customer
        // wants to know.
        if (!canCustomerCancel(order.status)) {
          return refuse(
            "too_late",
            `This order is already "${ORDER_STATUS_LABELS[order.status]}", so it can't be cancelled. A return is the route once something has shipped.`,
          );
        }

        const result = await updateOrderStatus(orderId, "cancelled", {}, ctx.db);
        if (!result.ok) return { ok: false as const, code: result.code };
        return {
          ok: true as const,
          cancelled: presentOrder(result.order),
          note: "The stock went back to the catalog and the charge was reversed in full.",
        };
      },
    }),

    cancelBooking: tool({
      description:
        "Cancel a caretaker booking the customer is part of. Ask them to confirm first, naming the booking and its dates.",
      inputSchema: z.object({
        bookingId: z.string(),
        confirm,
      }),
      execute: async ({ bookingId }) => {
        const uid = await assertBookingParticipant(ctx, bookingId);
        if (typeof uid !== "string") return uid;

        // No actor is passed: cancelling is open to either party, and the
        // participant check above has already established this caller is one.
        const result = await updateBookingStatus(bookingId, "cancelled", ctx.db);
        if (!result.ok) {
          if (result.code === "not_found") return refuse("not_found");
          return {
            ok: false as const,
            code: result.code,
            detail:
              result.code === "invalid_transition"
                ? `A booking that is already "${result.from}" cannot be cancelled.`
                : "Only the other party can make that change.",
          };
        }
        return { ok: true as const, cancelled: presentBooking(result.booking) };
      },
    }),

    cancelAppointment: tool({
      description:
        "Cancel a vet appointment the customer is part of. Note that only the vet can confirm, decline, start or complete an appointment — cancelling is the only status change an owner may make.",
      inputSchema: z.object({
        appointmentId: z.string(),
        confirm,
      }),
      execute: async ({ appointmentId }) => {
        const uid = await assertAppointmentParticipant(ctx, appointmentId);
        if (typeof uid !== "string") return uid;

        const appointment = await getAppointmentById(appointmentId, ctx.db);
        if (!appointment) return refuse("not_found");

        // Derived from the session, never taken as an argument. Being "the vet"
        // means actually owning the vet profile this appointment was booked
        // with; there is no way for the model to assert it.
        const actor = await appointmentActor(ctx, appointment.vetId);

        const result = await updateAppointmentStatus(
          appointmentId,
          "cancelled",
          actor,
          ctx.db,
        );
        if (!result.ok) {
          return result.code === "not_found"
            ? refuse("not_found")
            : { ok: false as const, code: result.code };
        }
        return { ok: true as const, cancelled: presentAppointment(result.appointment) };
      },
    }),

    markNotificationsRead: tool({
      description:
        "Mark the customer's notifications as read. Omit the id to clear all of them.",
      inputSchema: z.object({
        notificationId: z
          .string()
          .optional()
          .describe("One notification, or omit to mark everything read."),
      }),
      execute: async ({ notificationId }) => {
        const uid = requireSignedIn(ctx);
        if (typeof uid !== "string") return uid;
        // markRead is already scoped to the user, so an id belonging to someone
        // else simply matches nothing.
        const marked = await markRead(uid, notificationId, ctx.db);
        return { ok: true as const, marked };
      },
    }),
  };
}
