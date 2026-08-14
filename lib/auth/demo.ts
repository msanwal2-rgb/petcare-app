/**
 * Demo account constants.
 *
 * The app stays instantly explorable — one-tap login on /login — even with real
 * auth enabled. Nothing here is a secret: the password only ever unlocks
 * throwaway seed data.
 *
 * These ids live here rather than in the seed data so the login page can import
 * them without pulling a thousand lines of fixtures into the client bundle.
 * The seeder is the other half of the contract: these users must exist.
 */

export const DEMO_PASSWORD = "leashdemo123";

/** One seeded account per role, for the one-tap demo buttons. */
export const DEMO_ACCOUNTS = {
  owner: "u1", // Maya Chen — two pets, active bookings, orders in flight
  caretaker: "u10", // Elena Petrova — 5.0 rating, incoming requests
  vet: "u17", // Dr. Naomi Ruiz — general practice, a full schedule
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;
