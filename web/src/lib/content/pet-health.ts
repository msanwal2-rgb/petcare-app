/**
 * Editorial content for /pet-health.
 *
 * Typed data rather than hardcoded JSX so the page stays a thin renderer and
 * the content can later come from a CMS without touching the layout.
 *
 * Scope note: this is general guidance written to help an owner decide whether
 * and how urgently to see a vet. It is deliberately not diagnostic, and every
 * section routes to booking a real appointment rather than substituting for one.
 */

import type { Species } from "@/types";

export interface VaccineRow {
  name: string;
  firstDose: string;
  boosters: string;
  note: string;
}

export interface VaccineSchedule {
  species: Species;
  title: string;
  core: VaccineRow[];
  optional: VaccineRow[];
}

export const VACCINE_SCHEDULES: VaccineSchedule[] = [
  {
    species: "dog",
    title: "Dogs",
    core: [
      {
        name: "DHPP (distemper, hepatitis, parvovirus, parainfluenza)",
        firstDose: "6–8 weeks",
        boosters: "Every 2–4 weeks until 16 weeks, then 1 year, then every 1–3 years",
        note: "Parvovirus is the reason puppies shouldn't meet unknown dogs before the course is finished.",
      },
      {
        name: "Rabies",
        firstDose: "12–16 weeks",
        boosters: "1 year later, then every 1–3 years depending on the vaccine and local law",
        note: "Legally required in most places, and the one your boarding caretaker will ask to see.",
      },
    ],
    optional: [
      {
        name: "Bordetella (kennel cough)",
        firstDose: "8 weeks",
        boosters: "Every 6–12 months",
        note: "Usually required before boarding or daycare — worth having if you use either.",
      },
      {
        name: "Leptospirosis",
        firstDose: "12 weeks",
        boosters: "Annually",
        note: "Risk depends on standing water and wildlife where you walk.",
      },
      {
        name: "Lyme",
        firstDose: "12 weeks",
        boosters: "Annually",
        note: "Recommended in tick-heavy regions only.",
      },
    ],
  },
  {
    species: "cat",
    title: "Cats",
    core: [
      {
        name: "FVRCP (rhinotracheitis, calicivirus, panleukopenia)",
        firstDose: "6–8 weeks",
        boosters: "Every 3–4 weeks until 16 weeks, then 1 year, then every 3 years",
        note: "Indoor cats need this too — panleukopenia travels in on shoes.",
      },
      {
        name: "Rabies",
        firstDose: "12–16 weeks",
        boosters: "1 year later, then every 1–3 years",
        note: "Required by law in most areas regardless of whether the cat goes outside.",
      },
    ],
    optional: [
      {
        name: "FeLV (feline leukaemia)",
        firstDose: "8 weeks",
        boosters: "Annually while the risk continues",
        note: "Strongly recommended for any cat with outdoor access.",
      },
    ],
  },
  {
    species: "other",
    title: "Rabbits, ferrets and birds",
    core: [
      {
        name: "Rabbit: RHDV2 and myxomatosis",
        firstDose: "From 5–10 weeks depending on the vaccine",
        boosters: "Every 6–12 months",
        note: "RHDV2 is fatal and spreads without direct contact. Availability varies by region.",
      },
      {
        name: "Ferret: distemper and rabies",
        firstDose: "8 weeks (distemper), 12 weeks (rabies)",
        boosters: "Annually",
        note: "Canine distemper is almost always fatal in ferrets.",
      },
    ],
    optional: [
      {
        name: "Birds: polyomavirus",
        firstDose: "From 4 weeks in at-risk collections",
        boosters: "Annually",
        note: "Mostly relevant to breeding aviaries rather than a single companion bird.",
      },
    ],
  },
];

export interface RedFlag {
  sign: string;
  why: string;
  species: Species[];
}

/**
 * Signs that mean "phone the clinic now" rather than "book something this week".
 * Kept short on purpose — a list of forty items is a list nobody reads in a panic.
 */
export const RED_FLAGS: RedFlag[] = [
  {
    sign: "Difficulty breathing, or open-mouth breathing in a cat",
    why: "Cats only mouth-breathe when they are in real trouble. Treat it as an emergency.",
    species: ["dog", "cat", "other"],
  },
  {
    sign: "Repeated unproductive retching with a swollen, hard belly",
    why: "In deep-chested dogs this can be bloat (GDV), which is fatal within hours without surgery.",
    species: ["dog"],
  },
  {
    sign: "Straining in the litter tray without producing urine",
    why: "A blocked male cat is a few hours from kidney failure. Do not wait until morning.",
    species: ["cat"],
  },
  {
    sign: "A seizure lasting more than two minutes, or seizures back to back",
    why: "Prolonged seizure activity causes lasting damage and needs drugs to stop.",
    species: ["dog", "cat", "other"],
  },
  {
    sign: "Pale white or grey gums, collapse, or unresponsiveness",
    why: "Suggests internal bleeding, shock, or severe anaemia.",
    species: ["dog", "cat", "other"],
  },
  {
    sign: "Known ingestion of chocolate, xylitol, grapes, lilies, or antifreeze",
    why: "Time matters far more than symptoms — some of these are treatable only before signs appear.",
    species: ["dog", "cat", "other"],
  },
  {
    sign: "A rabbit that hasn't eaten or passed droppings for 12 hours",
    why: "Gut stasis in rabbits is a genuine emergency, not a fussy appetite.",
    species: ["other"],
  },
  {
    sign: "Any bird sitting fluffed at the bottom of the cage",
    why: "Birds hide illness until they can't. Visible sickness usually means it's advanced.",
    species: ["other"],
  },
];

export interface Guide {
  slug: string;
  title: string;
  summary: string;
  points: string[];
}

export const CARE_GUIDES: Guide[] = [
  {
    slug: "parasites",
    title: "Parasite prevention, year round",
    summary:
      "Fleas, ticks, heartworm and intestinal worms are cheaper to prevent than to treat, and most preventives cover several at once.",
    points: [
      "Fleas survive indoors through winter — seasonal dosing leaves gaps that turn into infestations.",
      "Heartworm prevention is monthly and requires a negative test first; giving it to an infected dog is dangerous.",
      "Check for ticks after every walk in long grass, and remove them with a tick hook rather than fingers.",
      "Worm a puppy or kitten every two weeks until twelve weeks old, then monthly to six months.",
      "Ask your vet which preventive suits your pet's weight and region — the right product is a prescription decision.",
    ],
  },
  {
    slug: "nutrition",
    title: "Feeding, weight and food sensitivities",
    summary:
      "Most 'food allergies' are actually intolerances, and most weight problems are treats rather than meals.",
    points: [
      "Weigh food rather than scooping it. A cup of kibble varies by up to 30% between brands.",
      "Treats should be under 10% of daily calories — including the bits used for training.",
      "A true elimination trial runs eight weeks on a single hydrolysed or novel protein, with nothing else by mouth.",
      "Switch foods over 7–10 days, mixing increasing proportions of the new food, to avoid an upset gut.",
      "Sudden weight loss with a good appetite is a reason to see a vet, not a diet success.",
    ],
  },
  {
    slug: "dental",
    title: "Teeth, and why breath matters",
    summary:
      "Dental disease is the most common diagnosis in adult dogs and cats, and it is painful long before an owner notices.",
    points: [
      "Bad breath is not normal. It is usually the first sign of periodontal disease.",
      "Daily brushing is the only thing proven to work well; chews and additives help, but don't replace it.",
      "A professional cleaning needs general anaesthesia and full-mouth radiographs — most disease is below the gum line.",
      "Pets rarely stop eating because of dental pain. They just eat differently.",
    ],
  },
  {
    slug: "senior",
    title: "Ageing well",
    summary:
      "Most 'slowing down with age' is treatable arthritis, dental pain, or an endocrine problem.",
    points: [
      "From about seven years old, twice-yearly check-ups catch more than annual ones.",
      "Reluctance to jump, use stairs, or be handled is pain, not personality.",
      "Increased drinking is worth a same-week appointment — it points at kidneys, diabetes or Cushing's.",
      "Weight control does more for arthritic joints than any supplement.",
    ],
  },
  {
    slug: "handover",
    title: "Handing your pet to a caretaker",
    summary:
      "The information a sitter or boarder actually needs, and how to make sure they have it.",
    points: [
      "Keep vaccinations current — boarding and daycare will ask, and so will a good sitter.",
      "Write feeding amounts and times down; 'a scoop, twice a day' means nothing to someone else.",
      "List medications with dose and timing, and show where they're kept.",
      "Give your caretaker your vet's number and permission to seek treatment if they can't reach you.",
      "Flag the things that make your pet anxious — storms, other dogs, being left alone — before the first day.",
    ],
  },
];
