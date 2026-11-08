import type { Sex, Species } from "@/types";
import type { GuestContact, GuestPet } from "@/api/guest";
import { ApiError } from "@/api/_client";

/**
 * "Your details & your pet" — the state and rules behind `GuestDetailsForm`
 * (STATUS §3-G). The rules mirror the API's (`GuestValidators`); the server
 * checks them again and its issues land on the same fields (`issueErrors`).
 */

export interface GuestDetails {
  name: string;
  email: string;
  phone: string;
  petName: string;
  species: Species;
  breed: string;
  sex: Sex;
  dob: string;
  weightLbs: string;
  allergies: string;
  behaviorNotes: string;
  saveAccount: boolean;
}

export const EMPTY_GUEST: GuestDetails = {
  name: "",
  email: "",
  phone: "",
  petName: "",
  species: "dog",
  breed: "",
  sex: "male",
  dob: "",
  weightLbs: "",
  allergies: "",
  behaviorNotes: "",
  // Unticked: an account is something the guest asks for, not something to untick.
  saveAccount: false,
};

type FieldKey = keyof GuestDetails;
export type GuestErrors = Partial<Record<FieldKey, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()\-. ]{7,20}$/;

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What is wrong with the details, by field. Empty when they can be sent. */
export function guestProblems(d: GuestDetails): GuestErrors {
  const e: GuestErrors = {};
  if (!d.name.trim()) e.name = "What should we call you?";
  if (!EMAIL.test(d.email.trim())) e.email = "Enter a valid email.";
  if (!d.phone.trim()) e.phone = "Add a phone number so they can reach you.";
  else if (!PHONE.test(d.phone.trim())) e.phone = "Digits, spaces and + ( ) - only.";
  if (!d.petName.trim()) e.petName = "Give your pet a name.";
  if (!d.dob) e.dob = "Add their date of birth — a guess is fine.";
  else if (d.dob > todayKey()) e.dob = "Date of birth must be in the past.";
  const w = Number(d.weightLbs);
  if (d.weightLbs.trim() === "" || !Number.isInteger(w) || w < 0 || w > 400) {
    e.weightLbs = "Weight in whole pounds, 0–400.";
  }
  return e;
}

export function toGuestContact(d: GuestDetails): GuestContact {
  return { name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim() };
}

export function toGuestPet(d: GuestDetails): GuestPet {
  const allergies = d.allergies
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return {
    name: d.petName.trim(),
    species: d.species,
    breed: d.breed.trim(),
    sex: d.sex,
    dob: d.dob,
    weightLbs: Number(d.weightLbs),
    allergies,
    behaviorNotes: d.behaviorNotes.trim() || undefined,
  };
}

const SERVER_FIELDS: Record<string, FieldKey> = {
  "guest.name": "name",
  "guest.email": "email",
  "guest.phone": "phone",
  "pet.name": "petName",
  "pet.species": "species",
  "pet.breed": "breed",
  "pet.sex": "sex",
  "pet.dob": "dob",
  "pet.weightLbs": "weightLbs",
  "pet.behaviorNotes": "behaviorNotes",
};

/** The server's 400 issues, on the fields of this form. */
export function issueErrors(error: unknown): GuestErrors {
  if (!(error instanceof ApiError) || !error.issues) return {};
  const out: GuestErrors = {};
  for (const issue of error.issues) {
    const key = SERVER_FIELDS[issue.path] ?? (issue.path.startsWith("pet.allergies") ? "allergies" : undefined);
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
