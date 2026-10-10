/**
 * Booking-in-progress state (brief §2/§7). Holds the multi-step booking
 * request as the owner moves Search → Request → Confirm, so the signature
 * leash-line progress and the review step have a single source of truth.
 * Not persisted — a draft only lives for the current flow.
 */

import { create } from "zustand";
import type { ServiceType } from "@/types";

export type BookingStep = "details" | "review" | "confirm";

interface BookingDraftState {
  caretakerId: string | null;
  petIds: string[];
  serviceType: ServiceType | null;
  startDateTime: string; // ISO or ""
  endDateTime: string;
  notes: string;
  step: BookingStep;
  set: (patch: Partial<Omit<BookingDraftState, "set" | "reset" | "togglePet">>) => void;
  togglePet: (petId: string) => void;
  reset: (caretakerId?: string) => void;
}

const empty = {
  petIds: [] as string[],
  serviceType: null as ServiceType | null,
  startDateTime: "",
  endDateTime: "",
  notes: "",
  step: "details" as BookingStep,
};

export const useBookingDraft = create<BookingDraftState>((set) => ({
  caretakerId: null,
  ...empty,
  set: (patch) => set(patch),
  togglePet: (petId) =>
    set((s) => ({
      petIds: s.petIds.includes(petId)
        ? s.petIds.filter((id) => id !== petId)
        : [...s.petIds, petId],
    })),
  reset: (caretakerId) => set({ caretakerId: caretakerId ?? null, ...empty }),
}));
