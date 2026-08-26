/**
 * Link tools: the assistant's way of handing an action back to the human.
 *
 * These are the counterpart to the tools that do not exist. There is no
 * `placeOrder`, no `createBooking`, no `bookAppointment` — instead the
 * assistant produces a link into the form the customer would have used, with
 * what it already knows filled in, and says so.
 */

import { tool } from "ai";
import { z } from "zod";
import type { AssistantContext } from "../context";
import {
  KNOWN_PAGES,
  openPage,
  signInLink,
  startCaretakerBooking,
  startCheckout,
  startVetAppointment,
} from "../links";

export function linkTools(ctx: AssistantContext) {
  return {
    openPage: tool({
      description:
        "Link the customer to one of Leash's main pages. Use this rather than writing a URL yourself.",
      inputSchema: z.object({
        page: z
          .enum(Object.keys(KNOWN_PAGES) as [keyof typeof KNOWN_PAGES], )
          .describe("Which page to open."),
      }),
      execute: async ({ page }) => openPage(page),
    }),

    startCheckout: tool({
      description:
        "Hand the customer to checkout. You never place an order yourself — they press the button.",
      inputSchema: z.object({}),
      execute: async () => startCheckout(ctx),
    }),

    startCaretakerBooking: tool({
      description:
        "Open the booking form pre-filled for a caretaker. This does NOT create a booking — the customer submits it and the caretaker still has to accept.",
      inputSchema: z.object({
        caretakerId: z.string().describe("From searchCaretakers."),
        serviceType: z.enum(["walking", "sitting", "boarding", "daycare"]).optional(),
        startDateTime: z.string().optional().describe("ISO 8601."),
        endDateTime: z.string().optional().describe("ISO 8601."),
        petId: z.string().optional().describe("Must be one of the customer's own pets."),
      }),
      execute: async (input) => startCaretakerBooking(ctx, input),
    }),

    startVetAppointment: tool({
      description:
        "Open the vet appointment form pre-filled. This does NOT book anything — the customer submits it and the vet confirms or declines.",
      inputSchema: z.object({
        vetId: z.string().describe("From searchVets."),
        date: z.string().optional().describe("ISO date, e.g. 2026-09-02."),
        petId: z.string().optional().describe("Must be one of the customer's own pets."),
      }),
      execute: async (input) => startVetAppointment(ctx, input),
    }),

    offerSignIn: tool({
      description:
        "Give an anonymous visitor a sign-in link that returns them to the page they are on. Use this whenever a question needs their account.",
      inputSchema: z.object({}),
      execute: async () => signInLink(ctx),
    }),
  };
}
