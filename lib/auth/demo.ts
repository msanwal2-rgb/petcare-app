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

/**
 * One seeded account per role, for the one-tap demo buttons.
 *
 * The email is here alongside the id because signing in needs it, and
 * /api/users/:id no longer hands out email addresses — a public profile
 * endpoint had no business doing so. Both halves are public knowledge anyway:
 * the README lists them, and the password below unlocks nothing but fixtures.
 */
export const DEMO_ACCOUNTS = {
  // Maya Chen — two pets, active bookings, orders in flight
  owner: { id: "u1", email: "maya.chen@example.com" },
  // Elena Petrova — 5.0 rating, incoming requests
  caretaker: { id: "u10", email: "elena.petrova@example.com" },
  // Dr. Naomi Ruiz — general practice, a full schedule
  vet: { id: "u17", email: "naomi.ruiz@example.com" },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;
