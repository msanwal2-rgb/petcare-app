/**
 * Shapes domain records into what the model actually sees.
 *
 * Three jobs, all of them about preventing a specific class of wrong answer:
 *
 * 1. **Money is formatted here and only here.** Every amount leaves as
 *    "$59.98", never as 5998. The model cannot divide by 100 incorrectly if it
 *    never receives a number to divide — this is the same discipline
 *    `formatCents` enforces in the UI, moved to the tool boundary.
 *
 * 2. **Statuses become the words the UI uses.** The label maps in lib/utils.ts
 *    are the product's vocabulary; a bot that says "in transit" when the page
 *    says "Out for delivery" makes a customer doubt one of them.
 *
 * 3. **Fields the model has no business relaying are dropped.** Payment
 *    references, internal ids of other people's records, full addresses. What
 *    is not in the payload cannot be leaked by a confused answer.
 *
 * Everything returned from here is data the customer is already entitled to see
 * on their own pages — the guards decided that before we got here.
 */

import { formatCents, formatDate, formatDateTime, petAge } from "@/lib/utils";
import {
  APPOINTMENT_STATUS_LABELS,
  CONSULT_MODE_LABELS,
  ORDER_STATUS_LABELS,
  RECORD_TYPE_LABELS,
  SERVICE_LABELS,
  SPECIES_LABELS,
  STATUS_LABELS,
} from "@/lib/utils";
import { canCustomerCancel } from "@/lib/delivery";
import type {
  Booking,
  MedicalRecord,
  Order,
  Pet,
  Product,
  VetAppointment,
} from "@/types";

/* ── Store ────────────────────────────────────────────────────────── */

export function presentProduct(product: Product) {
  return {
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    price: formatCents(product.priceCents),
    wasPrice: product.compareAtPriceCents
      ? formatCents(product.compareAtPriceCents)
      : null,
    size: product.sizeLabel,
    forSpecies: product.species.map((s) => SPECIES_LABELS[s]),
    inStock: product.stockQty > 0,
    requiresPrescription: product.requiresPrescription,
    allergens: product.allergens,
    rating: product.rating.toFixed(1),
    href: `/store/${product.slug}`,
  };
}

export function presentOrder(order: Order, options: { detailed?: boolean } = {}) {
  const base = {
    orderId: order.id,
    status: ORDER_STATUS_LABELS[order.status],
    statusCode: order.status,
    placedOn: formatDate(order.placedAt),
    total: formatCents(order.totalCents),
    itemCount: order.items.reduce((n, item) => n + item.quantity, 0),
    // Stated up front so the model never has to infer the rule; it is the most
    // common question about an order and the easiest one to get wrong.
    canStillCancel: canCustomerCancel(order.status),
    href: `/store/orders/${order.id}`,
  };

  if (!options.detailed) return base;

  return {
    ...base,
    subtotal: formatCents(order.subtotalCents),
    shipping:
      order.shippingCents === 0 ? "Free" : formatCents(order.shippingCents),
    tax: formatCents(order.taxCents),
    items: order.items.map((item) => ({
      name: item.name,
      brand: item.brand,
      quantity: item.quantity,
      unitPrice: formatCents(item.unitPriceCents),
      lineTotal: formatCents(item.lineTotalCents),
      href: `/store/${item.slug}`,
    })),
    // The customer-facing timeline, which is what "where is my order" means.
    tracking: order.events.map((event) => ({
      stage: event.label,
      detail: event.description,
      at: formatDateTime(event.occurredAt),
    })),
    estimatedDelivery: order.estimatedDeliveryAt
      ? formatDate(order.estimatedDeliveryAt)
      : null,
    deliveredOn: order.deliveredAt ? formatDate(order.deliveredAt) : null,
    // Deliberately absent: paymentRef, paymentStatus, the shipping address.
    // None of it helps answer a support question, and all of it is worth not
    // having in a transcript.
    shippingTo: `${order.shippingAddress.city}, ${order.shippingAddress.state}`,
  };
}

/* ── Care ─────────────────────────────────────────────────────────── */

export function presentBooking(booking: Booking) {
  return {
    bookingId: booking.id,
    service: SERVICE_LABELS[booking.serviceType],
    status: STATUS_LABELS[booking.status],
    statusCode: booking.status,
    starts: formatDateTime(booking.startDateTime),
    ends: formatDateTime(booking.endDateTime),
    // Bookings are priced in dollars, not cents — the store is the only part of
    // the app on integer cents. Formatted the same way regardless.
    price: `$${booking.priceTotal.toFixed(2)}`,
    petIds: booking.petIds,
    href: `/booking/${booking.id}`,
  };
}

export function presentAppointment(appointment: VetAppointment) {
  return {
    appointmentId: appointment.id,
    reason: appointment.reason,
    status: APPOINTMENT_STATUS_LABELS[appointment.status],
    statusCode: appointment.status,
    format: CONSULT_MODE_LABELS[appointment.mode],
    starts: formatDateTime(appointment.startDateTime),
    fee: `$${appointment.fee.toFixed(2)}`,
    petId: appointment.petId,
    href: `/appointments/${appointment.id}`,
  };
}

/* ── Pets and health ──────────────────────────────────────────────── */

export function presentPet(pet: Pet, now = new Date()) {
  return {
    petId: pet.id,
    name: pet.name,
    species: SPECIES_LABELS[pet.species],
    breed: pet.breed,
    age: petAge(pet, now),
    weightLbs: pet.weightLbs,
    vaccinated: pet.vaccinated,
    allergies: pet.allergies,
    medications: pet.medications,
    href: `/dashboard/pets/${pet.id}`,
  };
}

export function presentRecord(record: MedicalRecord) {
  return {
    type: RECORD_TYPE_LABELS[record.type],
    title: record.title,
    detail: record.details,
    on: formatDate(record.occurredAt),
    nextDue: record.nextDueAt ? formatDate(record.nextDueAt) : null,
  };
}

/**
 * A prescription, as the store's gate sees it — which is the only reason a
 * support conversation ever needs one.
 */
export function presentPrescription(record: MedicalRecord, now = new Date()) {
  const expired = record.expiresAt ? new Date(record.expiresAt) < now : false;
  return {
    medication: record.medicationName ?? record.title,
    dosage: record.dosage,
    refillsLeft: record.refillsLeft,
    expiresOn: record.expiresAt ? formatDate(record.expiresAt) : null,
    expired,
    unlocksProducts: record.productSlugs,
  };
}
