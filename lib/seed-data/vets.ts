/**
 * Seed data for the vet-care module: vet users, their clinic profiles,
 * appointments across the whole status lifecycle, and the medical records
 * those appointments produced.
 *
 * The records are deliberately wired to the existing pets so the cross-module
 * behaviour is demonstrable out of the box:
 *   • Luna (p4, owner u3) has a valid prescription for the hypoallergenic cat
 *     diet — so u3 can actually buy that Rx-only product in the store.
 *   • Pepper (p6, owner u4) has an Apoquel prescription and a recommended
 *     hydrolysed-protein diet.
 *   • Biscuit (p1) has a rabies booster falling due shortly after "today",
 *     which is what the health-record UI surfaces as a reminder.
 */

import type {
  MedicalRecord,
  Review,
  VetAppointment,
} from "@/types";
import type { SeedUser, SeedVetProfile } from "./types";
import { generateAvailability, TODAY } from "./index";
import { HEADSHOTS, unsplash } from "@/lib/media/photos";

const avatar = (i: number) => unsplash(HEADSHOTS[i % HEADSHOTS.length], 240, 240, "faces");

/* ── Vet users ────────────────────────────────────────────────────────
   Kept separate from the main `users` array only for readability; the seeder
   inserts both lists into the same table. */

export const vetUsers: SeedUser[] = [
  {
    id: "u17",
    name: "Dr. Naomi Ruiz",
    email: "naomi.ruiz@example.com",
    phone: "(512) 555-0801",
    avatarUrl: avatar(0),
    roles: ["vet"],
    address: { city: "Austin", state: "TX", lat: 30.2590, lng: -97.7480 },
    verified: true,
    createdAt: "2025-09-02T08:30:00Z",
  },
  {
    id: "u18",
    name: "Dr. Samuel Okafor",
    email: "samuel.okafor@example.com",
    phone: "(512) 555-0822",
    avatarUrl: avatar(5),
    roles: ["vet"],
    address: { city: "Austin", state: "TX", lat: 30.2980, lng: -97.7210 },
    verified: true,
    createdAt: "2025-06-18T11:00:00Z",
  },
  {
    id: "u19",
    name: "Dr. Lena Whitfield",
    email: "lena.whitfield@example.com",
    phone: "(303) 555-0844",
    avatarUrl: avatar(9),
    roles: ["vet"],
    address: { city: "Denver", state: "CO", lat: 39.7420, lng: -104.9880 },
    verified: true,
    createdAt: "2025-04-11T09:45:00Z",
  },
  {
    id: "u20",
    name: "Dr. Arjun Mehta",
    email: "arjun.mehta@example.com",
    phone: "(503) 555-0866",
    avatarUrl: avatar(11),
    roles: ["vet", "owner"], // a vet who is also a pet owner — exercises the role toggle
    address: { city: "Portland", state: "OR", lat: 45.5230, lng: -122.6760 },
    verified: true,
    createdAt: "2025-12-05T15:20:00Z",
  },
];

/* ── Clinic profiles ──────────────────────────────────────────────────── */

export const vets: SeedVetProfile[] = [
  {
    id: "v1",
    userId: "u17",
    clinicName: "South Austin Animal Hospital",
    bio: "General practice with a particular interest in nutrition and weight management. I'd rather spend twenty minutes on a feeding plan than sell you a supplement.",
    specialties: ["general", "nutrition"],
    licenseNumber: "TX-VM-44219",
    licenseState: "TX",
    yearsExperience: 12,
    acceptedSpecies: ["dog", "cat"],
    consultModes: ["in_clinic", "video"],
    consultFee: 85,
    emergencyAvailable: false,
    clinic: {
      name: "South Austin Animal Hospital",
      city: "Austin",
      state: "TX",
      lat: 30.2590,
      lng: -97.7480,
    },
    rating: 4.9,
    reviewCount: 214,
    responseRatePct: 98,
    availability: generateAvailability(TODAY, 14, "open"),
  },
  {
    id: "v2",
    userId: "u18",
    clinicName: "Northside Veterinary Dermatology",
    bio: "Board-certified in dermatology. Most of my week is chronic itching, ear disease, and food trials — the cases that have already been through two rounds of steroids.",
    specialties: ["dermatology", "general", "emergency"],
    licenseNumber: "TX-VM-38104",
    licenseState: "TX",
    yearsExperience: 18,
    acceptedSpecies: ["dog", "cat"],
    consultModes: ["in_clinic", "video"],
    consultFee: 140,
    emergencyAvailable: true,
    clinic: {
      name: "Northside Veterinary Dermatology",
      city: "Austin",
      state: "TX",
      lat: 30.2980,
      lng: -97.7210,
    },
    rating: 4.8,
    reviewCount: 167,
    responseRatePct: 92,
    availability: generateAvailability(TODAY, 14, "busy"),
  },
  {
    id: "v3",
    userId: "u19",
    clinicName: "Front Range Surgical & Dental",
    bio: "Soft-tissue surgery and dentistry. Every dental here includes full-mouth radiographs — you can't judge a tooth by its crown.",
    specialties: ["surgery", "dentistry"],
    licenseNumber: "CO-VM-11987",
    licenseState: "CO",
    yearsExperience: 21,
    acceptedSpecies: ["dog", "cat"],
    consultModes: ["in_clinic"],
    consultFee: 165,
    emergencyAvailable: true,
    clinic: {
      name: "Front Range Surgical & Dental",
      city: "Denver",
      state: "CO",
      lat: 39.7420,
      lng: -104.9880,
    },
    rating: 4.7,
    reviewCount: 98,
    responseRatePct: 88,
    availability: generateAvailability(TODAY, 14, "weekends"),
  },
  {
    id: "v4",
    userId: "u20",
    clinicName: "Willamette Exotics & Behaviour",
    bio: "Rabbits, birds, reptiles, and the behaviour cases nobody else has time for. Home visits across the east side — a fear-aggressive dog does better in its own kitchen.",
    specialties: ["exotics", "behavior", "general"],
    licenseNumber: "OR-VM-70551",
    licenseState: "OR",
    yearsExperience: 9,
    acceptedSpecies: ["dog", "cat", "other"],
    consultModes: ["video", "home_visit", "in_clinic"],
    consultFee: 110,
    emergencyAvailable: false,
    clinic: {
      name: "Willamette Exotics & Behaviour",
      city: "Portland",
      state: "OR",
      lat: 45.5230,
      lng: -122.6760,
    },
    rating: 4.9,
    reviewCount: 76,
    responseRatePct: 95,
    availability: generateAvailability(TODAY, 14, "open"),
  },
];

/* ── Appointments ─────────────────────────────────────────────────────
   Spread across every status so the dashboards and the status timeline all
   have something to render. */

export const appointments: VetAppointment[] = [
  {
    id: "a1",
    ownerId: "u3",
    vetId: "v1",
    petId: "p4", // Luna — chicken/grain allergy
    mode: "in_clinic",
    reason: "Recurrent itching and over-grooming",
    symptoms: ["Itching", "Hair loss", "Over-grooming"],
    startDateTime: "2026-06-20T15:00:00Z",
    endDateTime: "2026-06-20T15:45:00Z",
    status: "completed",
    fee: 85,
    notes: "Second flare-up this year. Diet has not been changed.",
    createdAt: "2026-06-16T10:12:00Z",
  },
  {
    id: "a2",
    ownerId: "u4",
    vetId: "v2",
    petId: "p6", // Pepper — already on Apoquel
    mode: "in_clinic",
    reason: "Atopic dermatitis review",
    symptoms: ["Itching", "Red skin", "Ear irritation"],
    startDateTime: "2026-07-01T17:30:00Z",
    endDateTime: "2026-07-01T18:15:00Z",
    status: "completed",
    fee: 140,
    notes: "Six-month review while on Apoquel.",
    createdAt: "2026-06-24T09:00:00Z",
  },
  {
    id: "a3",
    ownerId: "u1",
    vetId: "v1",
    petId: "p1", // Biscuit — rabies booster due
    mode: "in_clinic",
    reason: "Annual wellness exam and rabies booster",
    symptoms: [],
    startDateTime: "2026-07-12T16:00:00Z",
    endDateTime: "2026-07-12T16:30:00Z",
    status: "confirmed",
    fee: 85,
    notes: "Booster is due in August — happy to do it early at the wellness visit.",
    createdAt: "2026-07-02T19:24:00Z",
  },
  {
    id: "a4",
    ownerId: "u1",
    vetId: "v1",
    petId: "p2", // Miso
    mode: "video",
    reason: "Occasional vomiting after meals",
    symptoms: ["Vomiting", "Reduced appetite"],
    startDateTime: "2026-07-15T14:00:00Z",
    endDateTime: "2026-07-15T14:30:00Z",
    status: "requested",
    fee: 85,
    notes: "Twice in the last week, both within an hour of eating. Otherwise bright.",
    createdAt: `${TODAY}T08:40:00Z`,
  },
  {
    id: "a5",
    ownerId: "u14",
    vetId: "v3",
    petId: "p11", // Duke
    mode: "in_clinic",
    reason: "Dental cleaning with full-mouth radiographs",
    symptoms: ["Bad breath", "Tartar"],
    startDateTime: "2026-06-11T14:00:00Z",
    endDateTime: "2026-06-11T17:00:00Z",
    status: "completed",
    fee: 165,
    notes: "",
    createdAt: "2026-05-28T12:05:00Z",
  },
  {
    id: "a6",
    ownerId: "u6",
    vetId: "v2",
    petId: "p9", // Rex
    mode: "in_clinic",
    reason: "Limping on the left hind leg",
    symptoms: ["Limping"],
    startDateTime: "2026-07-04T15:00:00Z",
    endDateTime: "2026-07-04T15:45:00Z",
    status: "cancelled",
    fee: 140,
    notes: "Resolved on its own after two days of rest.",
    createdAt: "2026-07-02T11:30:00Z",
  },
  {
    id: "a8",
    ownerId: "u1",
    vetId: "v1",
    petId: "p1", // Biscuit
    mode: "in_clinic",
    reason: "Limping on the front right leg",
    symptoms: ["Limping"],
    startDateTime: "2026-06-30T16:00:00Z",
    endDateTime: "2026-06-30T16:30:00Z",
    status: "completed",
    fee: 85,
    notes: "Started after a long hike at the weekend.",
    createdAt: "2026-06-27T09:10:00Z",
  },
  {
    id: "a7",
    ownerId: "u5",
    vetId: "v4",
    petId: "p7", // Ziggy — an "other" species, exercises the exotics vet
    mode: "home_visit",
    reason: "Reduced appetite and lethargy",
    symptoms: ["Reduced appetite", "Lethargy"],
    startDateTime: `${TODAY}T18:00:00Z`,
    endDateTime: `${TODAY}T18:45:00Z`,
    status: "in_progress",
    fee: 110,
    notes: "Eating about half the usual amount for three days.",
    createdAt: "2026-07-06T20:10:00Z",
  },
];

/* ── Medical records ──────────────────────────────────────────────────
   The durable output of care. Prescription entries are what unlock the
   Rx-only products in the store. */

export const medicalRecords: MedicalRecord[] = [
  /* Luna (p4) — the completed allergy work-up at a1 */
  {
    id: "mr1",
    petId: "p4",
    appointmentId: "a1",
    vetId: "v1",
    authorUserId: "u17",
    type: "visit_note",
    title: "Suspected food-responsive dermatitis",
    details:
      "Bilateral flank alopecia consistent with over-grooming. No fleas found. Starting an eight-week hydrolysed-protein elimination trial — nothing else by mouth, including treats. Recheck at six weeks.",
    occurredAt: "2026-06-20T15:45:00Z",
    nextDueAt: "2026-08-01T15:00:00Z",
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: ["vetline-hypoallergenic-cat-dry"],
    createdAt: "2026-06-20T16:02:00Z",
  },
  {
    id: "mr2",
    petId: "p4",
    appointmentId: "a1",
    vetId: "v1",
    authorUserId: "u17",
    type: "prescription",
    title: "Hypoallergenic hydrolysed protein diet",
    details:
      "Sole diet for eight weeks. No other food, treats, or flavoured medication during the trial.",
    occurredAt: "2026-06-20T15:45:00Z",
    nextDueAt: null,
    medicationName: "VetLine Hypoallergenic Hydrolysed Protein (cat)",
    dosage: "Feed 1/2 cup twice daily. Sole diet — no treats.",
    refillsLeft: 3,
    expiresAt: "2026-12-20T00:00:00Z",
    productSlugs: ["vetline-hypoallergenic-cat-dry"],
    createdAt: "2026-06-20T16:02:00Z",
  },
  {
    id: "mr3",
    petId: "p4",
    appointmentId: "a1",
    vetId: "v1",
    authorUserId: "u17",
    type: "weight",
    title: "Weight recorded: 12.0 lb",
    details: "Body condition score 5/9. Ideal.",
    occurredAt: "2026-06-20T15:05:00Z",
    nextDueAt: null,
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: [],
    createdAt: "2026-06-20T16:02:00Z",
  },

  /* Pepper (p6) — dermatology review at a2 */
  {
    id: "mr4",
    petId: "p6",
    appointmentId: "a2",
    vetId: "v2",
    authorUserId: "u18",
    type: "visit_note",
    title: "Atopic dermatitis — six-month review",
    details:
      "Well controlled on Apoquel. Skin quiet, ears clean. Continuing current dose and adding an omega-3 supplement for coat quality.",
    occurredAt: "2026-07-01T18:15:00Z",
    nextDueAt: "2027-01-01T00:00:00Z",
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: ["vitalcoat-omega-3-softgels", "vetline-hydrolyzed-protein-dog-dry"],
    createdAt: "2026-07-01T18:30:00Z",
  },
  {
    id: "mr5",
    petId: "p6",
    appointmentId: "a2",
    vetId: "v2",
    authorUserId: "u18",
    type: "prescription",
    title: "Apoquel 5.4 mg",
    details: "Continue for atopic dermatitis. Recheck before further refills.",
    occurredAt: "2026-07-01T18:15:00Z",
    nextDueAt: null,
    medicationName: "Apoquel (oclacitinib) 5.4 mg",
    dosage: "1 tablet with breakfast",
    refillsLeft: 5,
    expiresAt: "2027-01-01T00:00:00Z",
    productSlugs: [],
    createdAt: "2026-07-01T18:30:00Z",
  },

  {
    id: "mr11",
    petId: "p6",
    appointmentId: "a2",
    vetId: "v2",
    authorUserId: "u18",
    type: "prescription",
    title: "Hydrolysed protein diet",
    details:
      "Twelve-week trial alongside the Apoquel, with a view to reducing the dose if the skin stays quiet.",
    occurredAt: "2026-07-01T18:15:00Z",
    nextDueAt: null,
    medicationName: "VetLine Hydrolysed Protein (dog)",
    dosage: "Feed to weight; sole diet for twelve weeks.",
    refillsLeft: 4,
    expiresAt: "2027-01-01T00:00:00Z",
    productSlugs: ["vetline-hydrolyzed-protein-dog-dry"],
    createdAt: "2026-07-01T18:30:00Z",
  },

  /* Biscuit (p1) — vaccination history; the booster falls due next month */
  {
    id: "mr6",
    petId: "p1",
    appointmentId: null,
    vetId: "v1",
    authorUserId: "u17",
    type: "vaccination",
    title: "Rabies (3-year)",
    details: "Left hind limb. Batch RB-2291.",
    occurredAt: "2025-08-14T16:20:00Z",
    nextDueAt: "2026-08-14T00:00:00Z",
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: [],
    createdAt: "2025-08-14T16:40:00Z",
  },
  {
    id: "mr7",
    petId: "p1",
    appointmentId: null,
    vetId: "v1",
    authorUserId: "u17",
    type: "vaccination",
    title: "DHPP booster",
    details: "Annual booster. No adverse reaction.",
    occurredAt: "2026-02-11T10:15:00Z",
    nextDueAt: "2027-02-11T00:00:00Z",
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: [],
    createdAt: "2026-02-11T10:30:00Z",
  },

  {
    id: "mr12",
    petId: "p1",
    appointmentId: "a8",
    vetId: "v1",
    authorUserId: "u17",
    type: "visit_note",
    title: "Soft-tissue strain, front right",
    details:
      "No swelling and full range of motion. Almost certainly a strain from overdoing it. Short lead walks only for ten days, then build back up. Recheck if he is still favouring it after two weeks.",
    occurredAt: "2026-06-30T16:30:00Z",
    nextDueAt: null,
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: [],
    createdAt: "2026-06-30T16:45:00Z",
  },

  /* Miso (p2) */
  {
    id: "mr8",
    petId: "p2",
    appointmentId: null,
    vetId: "v1",
    authorUserId: "u17",
    type: "vaccination",
    title: "FVRCP booster",
    details: "Annual booster, well tolerated.",
    occurredAt: "2026-01-10T11:00:00Z",
    nextDueAt: "2027-01-10T00:00:00Z",
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: [],
    createdAt: "2026-01-10T11:20:00Z",
  },

  /* Duke (p11) — the dental at a5 */
  {
    id: "mr9",
    petId: "p11",
    appointmentId: "a5",
    vetId: "v3",
    authorUserId: "u19",
    type: "visit_note",
    title: "Dental cleaning with full-mouth radiographs",
    details:
      "Grade 2 tartar removed. Radiographs clear — no extractions needed. Start daily dental chews and recheck in twelve months.",
    occurredAt: "2026-06-11T17:00:00Z",
    nextDueAt: "2027-06-11T00:00:00Z",
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: ["freshgrin-dental-chews-dog"],
    createdAt: "2026-06-11T17:25:00Z",
  },
  {
    id: "mr10",
    petId: "p11",
    appointmentId: null,
    vetId: null,
    authorUserId: "u14",
    type: "allergy",
    title: "Beef intolerance",
    details:
      "Owner-reported: loose stools within a day of anything containing beef. Avoiding it entirely.",
    occurredAt: "2025-10-02T00:00:00Z",
    nextDueAt: null,
    medicationName: null,
    dosage: null,
    refillsLeft: null,
    expiresAt: null,
    productSlugs: [],
    createdAt: "2025-10-02T09:00:00Z",
  },
];

/* ── Reviews of completed visits ──────────────────────────────────────
   One direction only: the pet's owner reviews the vet. The seeded
   `reviewCount` on each profile stands for reputation earned before this
   database existed, so these are simply the written ones. */

export const vetReviews: Review[] = [
  {
    id: "vr1",
    subjectId: "a1", // Luna's allergy work-up with Dr. Ruiz
    kind: "vet_appointment",
    fromUserId: "u3",
    toUserId: "u17",
    rating: 5,
    comment:
      "She spent twenty minutes explaining why the food trial has to be strict, instead of just handing me a bag. Luna has stopped over-grooming for the first time in a year.",
    createdAt: "2026-06-22T09:15:00Z",
  },
  {
    id: "vr2",
    subjectId: "a2", // Pepper's dermatology review with Dr. Okafor
    kind: "vet_appointment",
    fromUserId: "u4",
    toUserId: "u18",
    rating: 5,
    comment:
      "Third vet we have seen for Pepper's itching and the first to actually get it under control. Worth the drive across town.",
    createdAt: "2026-07-03T17:40:00Z",
  },
  {
    id: "vr3",
    subjectId: "a5", // Duke's dental with Dr. Whitfield
    kind: "vet_appointment",
    fromUserId: "u14",
    toUserId: "u19",
    rating: 4,
    comment:
      "Thorough work and the radiographs were reassuring. Only note is that the wait to get in was a few weeks longer than I expected.",
    createdAt: "2026-06-14T11:20:00Z",
  },
];
