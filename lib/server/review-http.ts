/**
 * Turning a CreateReviewResult into a response.
 *
 * Bookings and vet appointments post reviews through separate routes but fail
 * in exactly the same ways, so the mapping from failure to status code lives
 * here rather than twice.
 */

import type { CreateReviewResult } from "./reviews";
import { error, forbidden, notFound, ok } from "./http";

export function reviewResponse(
  result: CreateReviewResult,
  subject: "Booking" | "Appointment"
): Response {
  if (result.ok) return ok(result.review, 201);

  switch (result.code) {
    case "not_found":
      return notFound(`${subject} not found`);
    case "not_completed":
      // 409, not 403: the request is legitimate, just early.
      return error(
        `You can review this once the ${subject.toLowerCase()} is complete`,
        409
      );
    case "already_reviewed":
      return error("You've already reviewed this", 409);
    case "not_a_participant":
      return forbidden("You can only review something you took part in");
    case "wrong_recipient":
      return forbidden("That isn't who this review can be about");
  }
}
