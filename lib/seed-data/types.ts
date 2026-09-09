/**
 * Fixture shapes for the seeder.
 *
 * A seeded user is written straight into the database, so it carries the
 * columns the seeder sets and nothing more. The API's `User` type has since
 * grown fields that are *derived* per account at runtime — `staffRoles` and
 * `status` — and forcing every one of the two dozen fixtures below to restate
 * `staffRoles: []` and `status: "active"` would be noise that says nothing.
 *
 * `staffRoles` is therefore optional here and defaults to none; the seeder
 * grants them explicitly to the handful of accounts that have them.
 */

import type { StaffRole, User, VetProfile } from "@/types";

export type SeedUser = Omit<User, "staffRoles" | "status"> & {
  staffRoles?: StaffRole[];
};


/**
 * A seeded vet profile. `verificationStatus` is set by the seeder rather than
 * restated on each fixture — the seeded vets are the demo's licensed
 * professionals and are all verified, and repeating that four times says
 * nothing.
 */
export type SeedVetProfile = Omit<VetProfile, "verificationStatus"> & {
  verificationStatus?: VetProfile["verificationStatus"];
};
