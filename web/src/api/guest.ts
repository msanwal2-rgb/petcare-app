import type { ConsultMode, Sex, ServiceType, Species } from "@/types";
import { postJson } from "./_client";

/**
 * Booking as a guest — API client (STATUS §3-G).
 *
 * Both routes are public. They carry who the guest is, their pet's basics
 * and the request; never a price, an owner or a pet id. The server writes the
 * guest, a new pet and the booking together, by the signed-in rules.
 *
 * Refusals arrive as `ApiError`:
 *  - 409 `details.code === "account_exists"` — that email has an account: log in;
 *  - 409 `details.code === "not_available"` — outside the provider's calendar;
 *  - 409 with `leadTimeHours` — too soon (a guest is never a member);
 *  - 429 — rate limited;
 *  - 400 with `issues` naming `guest.email`, `pet.dob`, `booking.startDateTime`…
 */

export interface GuestContact {
  name: string;
  email: string;
  phone: string;
}

export interface GuestPet {
  name: string;
  species: Species;
  breed: string;
  sex: Sex;
  /** "YYYY-MM-DD" */
  dob: string;
  weightLbs: number;
  allergies?: string[];
  behaviorNotes?: string;
}

export interface GuestBookingInput {
  guest: GuestContact;
  pet: GuestPet;
  booking: {
    caretakerId: string;
    serviceType: ServiceType;
    startDateTime: string;
    endDateTime: string;
    notes?: string;
    utcOffsetMinutes: number;
  };
  saveAccount: boolean;
}

export interface GuestAppointmentInput {
  guest: GuestContact;
  pet: GuestPet;
  appointment: {
    vetId: string;
    mode: ConsultMode;
    reason: string;
    symptoms?: string[];
    startDateTime: string;
    endDateTime: string;
    notes?: string;
    utcOffsetMinutes: number;
  };
  saveAccount: boolean;
}

/** What a guest booking returns. No user id, no pet id: the guest's next step is their inbox. */
export interface GuestBookingResult {
  booking: {
    id: string;
    status: string;
    serviceType: ServiceType;
    startDateTime: string;
    endDateTime: string;
    priceTotal: number;
  };
  caretakerName: string;
  petName: string;
  accountEmailSent: boolean;
  /** Development only. */
  devLink?: string;
}

export interface GuestAppointmentResult {
  appointment: {
    id: string;
    status: string;
    mode: ConsultMode;
    startDateTime: string;
    endDateTime: string;
    fee?: number;
  };
  vetName: string;
  petName: string;
  accountEmailSent: boolean;
  /** Development only. */
  devLink?: string;
}

/** POST /guest/bookings */
export function bookCaretakerAsGuest(input: GuestBookingInput): Promise<GuestBookingResult> {
  return postJson<GuestBookingResult>("/guest/bookings", input);
}

/** POST /guest/appointments */
export function bookVetAsGuest(input: GuestAppointmentInput): Promise<GuestAppointmentResult> {
  return postJson<GuestAppointmentResult>("/guest/appointments", input);
}
