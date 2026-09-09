/**
 * Shelter fixtures.
 *
 * Added at the end of the id space — `u24`/`u25` and `p13` onward — so every
 * assertion about the existing accounts and animals still holds. Repurposing
 * an existing pet as a shelter animal would have broken
 * `getPetsByOwner("u1") === ["p1","p2"]` and a dozen assertions like it.
 *
 * Two shelters, because one proves nothing about search or filtering, and both
 * verified so the demo shows the badge doing its job. The animals are chosen to
 * exercise the filters an adopter actually uses: a senior dog who needs a quiet
 * home, a bonded cat who is fine with other cats and not with dogs, and a
 * special-needs animal with a live prescription — which is the one that
 * demonstrates the whole point, because that prescription follows him to his
 * adopter and unlocks his food in the store.
 */

import type { Pet } from "@/types";
import type { SeedUser } from "./types";
import { HEADSHOTS, unsplash } from "@/lib/media/photos";

const PET_PHOTOS = [
  "photo-1568572933382-74d440642117",
  "photo-1543466835-00a7907e9de1",
  "photo-1514888286974-6c03e2ca1dba",
  "photo-1574158622682-e40e69881006",
];

export const shelterUsers: SeedUser[] = [
  {
    id: "u24",
    name: "Austin Pets Alive",
    email: "hello@austinpetsalive.example.com",
    phone: "(512) 555-0431",
    avatarUrl: unsplash(HEADSHOTS[11], 240, 240, "faces"),
    roles: ["shelter"],
    address: { city: "Austin", state: "TX", lat: 30.2545, lng: -97.7688 },
    verified: true,
    createdAt: "2025-03-14T09:00:00Z",
  },
  {
    id: "u25",
    name: "Hill Country Rescue",
    email: "adopt@hillcountryrescue.example.com",
    phone: "(512) 555-0688",
    avatarUrl: unsplash(HEADSHOTS[12], 240, 240, "faces"),
    roles: ["shelter"],
    address: { city: "Dripping Springs", state: "TX", lat: 30.1902, lng: -98.0867 },
    verified: true,
    createdAt: "2025-06-02T09:00:00Z",
  },
];

export interface SeedShelter {
  id: string;
  userId: string;
  name: string;
  bio: string;
  kind: string;
  registrationNumber: string;
  registrationState: string;
  verificationStatus: string;
  acceptedSpecies: string[];
  websiteUrl: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  adoptionPolicy: string;
  createdAt: string;
}

export const shelters: SeedShelter[] = [
  {
    id: "sh1",
    userId: "u24",
    name: "Austin Pets Alive",
    bio: "A no-kill shelter in south Austin. We take the animals other shelters can't — seniors, medical cases, and the ones who need a bit longer to trust somebody.",
    kind: "rescue",
    registrationNumber: "74-2963682",
    registrationState: "TX",
    verificationStatus: "verified",
    acceptedSpecies: ["dog", "cat", "other"],
    websiteUrl: "https://austinpetsalive.example.com",
    phone: "(512) 555-0431",
    email: "hello@austinpetsalive.example.com",
    addressLine: "1156 W Cesar Chavez St",
    city: "Austin",
    state: "TX",
    lat: 30.2545,
    lng: -97.7688,
    adoptionPolicy:
      "We ask for a completed application, a phone conversation, and a meet-and-greet with everyone in the household — including any dogs already at home. Most adoptions complete within a week. The fee covers vaccination, microchipping and neutering, and we will tell you before you apply if an animal has ongoing medical costs.",
    createdAt: "2025-03-14T09:00:00Z",
  },
  {
    id: "sh2",
    userId: "u25",
    name: "Hill Country Rescue",
    bio: "A small foster-based rescue west of Austin. Every animal here lives in somebody's house, so we can tell you honestly how they are with stairs, cats, thunderstorms and strangers.",
    kind: "foster_network",
    registrationNumber: "82-1104558",
    registrationState: "TX",
    verificationStatus: "verified",
    acceptedSpecies: ["dog", "cat"],
    websiteUrl: "https://hillcountryrescue.example.com",
    phone: "(512) 555-0688",
    email: "adopt@hillcountryrescue.example.com",
    addressLine: "410 Mercer St",
    city: "Dripping Springs",
    state: "TX",
    lat: 30.1902,
    lng: -98.0867,
    adoptionPolicy:
      "Because our animals live in foster homes, you meet them where they are, and their foster carer will tell you the truth about them. We do not adopt out to homes with children under five without a conversation first.",
    createdAt: "2025-06-02T09:00:00Z",
  },
];

/** Shelter animals. Ordinary pets — that is the whole design. */
export const shelterPets: Pet[] = [
  {
    id: "p13",
    ownerId: "u24",
    name: "Marlow",
    species: "dog",
    breed: "Beagle mix",
    sex: "male",
    dob: "2017-04-02",
    weightLbs: 28,
    photoUrl: unsplash(PET_PHOTOS[0], 800, 600),
    vaccinated: true,
    allergies: [],
    medications: ["Carprofen 25mg — daily, for arthritis"],
    behaviorNotes:
      "Nine years old and entirely done with excitement. Sleeps through most of the day, walks about a mile, and would like the sofa. Good with everyone; slow on stairs.",
    feedingInstructions: "1 cup senior kibble twice daily, softened with warm water.",
    vetContact: { name: "Austin Pets Alive Clinic", phone: "(512) 555-0431" },
  },
  {
    id: "p14",
    ownerId: "u24",
    name: "Pepper",
    species: "cat",
    breed: "Domestic shorthair",
    sex: "female",
    dob: "2023-08-19",
    weightLbs: 9,
    photoUrl: unsplash(PET_PHOTOS[1], 800, 600),
    vaccinated: true,
    allergies: [],
    medications: [],
    behaviorNotes:
      "Lived with two other cats and was the calmest of the three. Has never met a dog and we would rather she didn't. Hides for a day in a new house, then decides you are hers.",
    feedingInstructions: "Wet food morning and evening; dry food left out.",
    vetContact: { name: "Austin Pets Alive Clinic", phone: "(512) 555-0431" },
  },
  {
    id: "p15",
    ownerId: "u25",
    name: "Juniper",
    species: "dog",
    breed: "Border Collie",
    sex: "female",
    dob: "2024-02-11",
    weightLbs: 34,
    photoUrl: unsplash(PET_PHOTOS[2], 800, 600),
    vaccinated: true,
    allergies: ["Chicken"],
    medications: [],
    behaviorNotes:
      "Two years old and needs a job. Knows sit, down and her name, and will learn anything you can be bothered to teach her. Not a first dog, and not an apartment dog.",
    feedingInstructions:
      "2 cups grain-free twice daily — she reacts to chicken, so check the label.",
    vetContact: { name: "Dripping Springs Veterinary", phone: "(512) 555-0688" },
  },
];

export interface SeedListing {
  id: string;
  shelterId: string;
  petId: string;
  status: string;
  feeCents: number;
  headline: string;
  story: string;
  goodWithKids: string;
  goodWithDogs: string;
  goodWithCats: string;
  houseTrained: string;
  energyLevel: string;
  specialNeeds: boolean;
  specialNeedsNotes: string;
  spayedNeutered: boolean;
  microchipped: boolean;
  city: string;
  state: string;
  lat: number;
  lng: number;
  intakeAt: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Relative to seed time, so "waiting 40 days" stays true as time passes. */
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

export const listings: SeedListing[] = [
  {
    id: "al1",
    shelterId: "sh1",
    petId: "p13",
    status: "available",
    feeCents: 5000,
    headline: "Nine years old and looking for a sofa",
    story:
      "Marlow came in when his owner went into care. He is arthritic, he is not interested in your other dog's games, and he is the easiest animal in this building. He has been here four months because people scroll past grey faces. His medication costs about $18 a month and we will send you off with a month of it.",
    goodWithKids: "yes",
    goodWithDogs: "yes",
    goodWithCats: "unknown",
    houseTrained: "yes",
    energyLevel: "low",
    specialNeeds: true,
    specialNeedsNotes:
      "Daily anti-inflammatory for arthritis. Needs a home without many stairs.",
    spayedNeutered: true,
    microchipped: true,
    city: "Austin",
    state: "TX",
    lat: 30.2545,
    lng: -97.7688,
    intakeAt: daysAgo(122),
    publishedAt: daysAgo(120),
    createdAt: daysAgo(122),
    updatedAt: daysAgo(120),
  },
  {
    id: "al2",
    shelterId: "sh1",
    petId: "p14",
    status: "available",
    feeCents: 2500,
    headline: "Quiet, tidy, and would like to be an only cat — or one of several",
    story:
      "Pepper was surrendered with two other cats when their owner's landlord changed the rules. Her siblings have been adopted. She is calm, she uses the tray, and she asks for very little.",
    goodWithKids: "yes",
    goodWithDogs: "no",
    goodWithCats: "yes",
    houseTrained: "yes",
    energyLevel: "low",
    specialNeeds: false,
    specialNeedsNotes: "",
    spayedNeutered: true,
    microchipped: true,
    city: "Austin",
    state: "TX",
    lat: 30.2545,
    lng: -97.7688,
    intakeAt: daysAgo(38),
    publishedAt: daysAgo(35),
    createdAt: daysAgo(38),
    updatedAt: daysAgo(35),
  },
  {
    id: "al3",
    shelterId: "sh2",
    petId: "p15",
    // Juniper has an approved applicant (aa3), and approving takes an animal
    // off the market — so the fixture has to say so, or the demo shows a dog
    // as available who is already spoken for.
    status: "pending",
    feeCents: 15000,
    headline: "A working dog who needs a job",
    story:
      "Juniper is in foster with a family who run her twice a day and she is still ahead of them. She would be miserable in a flat and magnificent on a farm, at agility, or with anyone who wants a dog to do things with. She reacts to chicken — it took us a while to work that out, and it is in her record now so it will follow her.",
    goodWithKids: "yes",
    goodWithDogs: "yes",
    goodWithCats: "no",
    houseTrained: "yes",
    energyLevel: "high",
    specialNeeds: false,
    specialNeedsNotes: "",
    spayedNeutered: true,
    microchipped: true,
    // In foster, so where she is is not where the rescue is.
    city: "Wimberley",
    state: "TX",
    lat: 29.9974,
    lng: -98.0975,
    intakeAt: daysAgo(19),
    publishedAt: daysAgo(17),
    createdAt: daysAgo(19),
    updatedAt: daysAgo(17),
  },
];

export interface SeedApplication {
  id: string;
  listingId: string;
  shelterId: string;
  petId: string;
  petName: string;
  petPhotoUrl: string;
  applicantId: string;
  status: string;
  feeCents: number;
  householdAdults: number;
  householdChildren: number;
  hasOtherPets: boolean;
  otherPetsNotes: string;
  homeType: string;
  fencedYard: boolean;
  ownsHome: boolean;
  hoursAlonePerDay: number;
  experience: string;
  message: string;
  decisionNote: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One application in each state a shelter actually has to deal with, so the
 * queue is demonstrable the moment you sign in — and one *approved* so the
 * pay-and-complete flow can be walked without filling in a form first.
 */
export const applications: SeedApplication[] = [
  {
    id: "aa1",
    listingId: "al1",
    shelterId: "sh1",
    petId: "p13",
    petName: "Marlow",
    petPhotoUrl: unsplash(PET_PHOTOS[0], 800, 600),
    applicantId: "u3",
    status: "submitted",
    feeCents: 5000,
    householdAdults: 2,
    householdChildren: 0,
    hasOtherPets: false,
    otherPetsNotes: "",
    homeType: "house",
    fencedYard: true,
    ownsHome: true,
    hoursAlonePerDay: 4,
    experience: "Had a beagle for fourteen years. She died in March.",
    message:
      "We saw how long Marlow has been waiting. A quiet old dog is exactly what we were hoping for — we have a single-storey house and not much traffic.",
    decisionNote: "",
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
  },
  {
    id: "aa2",
    listingId: "al2",
    shelterId: "sh1",
    petId: "p14",
    petName: "Pepper",
    petPhotoUrl: unsplash(PET_PHOTOS[1], 800, 600),
    applicantId: "u5",
    status: "under_review",
    feeCents: 2500,
    householdAdults: 1,
    householdChildren: 0,
    hasOtherPets: true,
    otherPetsNotes: "One neutered male cat, six years old, very laid back.",
    homeType: "apartment",
    fencedYard: false,
    ownsHome: false,
    hoursAlonePerDay: 7,
    experience: "Cats my whole life.",
    message: "My landlord allows two. Happy to do a slow introduction.",
    decisionNote: "Landlord letter received. Arranging a meet.",
    createdAt: daysAgo(9),
    updatedAt: daysAgo(2),
  },
  {
    id: "aa3",
    listingId: "al3",
    shelterId: "sh2",
    petId: "p15",
    petName: "Juniper",
    petPhotoUrl: unsplash(PET_PHOTOS[2], 800, 600),
    applicantId: "u4",
    status: "approved",
    feeCents: 15000,
    householdAdults: 2,
    householdChildren: 1,
    hasOtherPets: false,
    otherPetsNotes: "",
    homeType: "house",
    fencedYard: true,
    ownsHome: true,
    hoursAlonePerDay: 2,
    experience:
      "We compete in agility with our older collie, who died last year. We know what this breed needs.",
    message: "We have five acres and a very bored agility course.",
    decisionNote:
      "Home check done, references excellent. Approved — settle the fee and we'll arrange collection.",
    createdAt: daysAgo(11),
    updatedAt: daysAgo(1),
  },
];


/**
 * When each shelter took its animals in.
 *
 * The migration backfills `ownedSince` to the epoch to grandfather engagements
 * that predate the column, and that is right for the twelve pets that already
 * existed. These animals are new, so they get the truth: the date the shelter
 * actually got them, which is the same date their listing shows.
 */
export const shelterPetOwnedSince: Record<string, string> = Object.fromEntries(
  listings.map((l) => [l.petId, l.intakeAt])
);
