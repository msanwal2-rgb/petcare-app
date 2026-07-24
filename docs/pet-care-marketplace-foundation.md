# Pet Care Marketplace — Product Foundation (v0.1)

## 1. Overview

A two-sided marketplace connecting **Pet Owners** with **Caretakers** for on-demand or scheduled pet care (walking, sitting, boarding, daycare), billed hourly or daily. This mirrors the trust-and-logistics model of Rover, Wag, or Airbnb — the hard parts are identity/trust, scheduling, and payments, not the UI.

---

## 2. User Roles & Profiles

### 2.1 Pet Owner Profile
| Field | Notes |
|---|---|
| Name, email, phone | Phone should be verified (SMS OTP) |
| Profile photo | |
| Home address / location | Geo-coordinates for caretaker matching |
| Emergency contact | Separate from owner, used if owner is unreachable |
| Payment method(s) | Tokenized only — never store raw card data (see §5) |
| Identity verification status | Optional but recommended (builds caretaker trust) |
| Linked pets | 1-to-many relationship |
| Booking history | Past & upcoming |
| Saved/favorite caretakers | |
| Reviews given/received | Owners can also be rated by caretakers |
| Notification preferences | Push/SMS/email |

### 2.2 Pet Profile
| Field | Notes |
|---|---|
| Name, species, breed, sex, DOB/age, weight | |
| Photo(s) | |
| Vaccination records | Upload/verify — some caretakers will require proof (rabies, etc.) |
| Allergies & medications | Including dosage/schedule if caretaker needs to administer |
| Behavioral notes | Temperament, good with kids/other animals, anxiety triggers |
| Feeding instructions | Type, quantity, schedule |
| Exercise needs | Walk frequency/duration |
| Microchip ID | Useful if pet goes missing |
| Vet contact info | Name, clinic, phone — critical for emergencies |
| Special/emergency instructions | Free text field caretaker must acknowledge reading |
| Pet insurance info | Optional |

### 2.3 Caretaker Profile
| Field | Notes |
|---|---|
| Name, photo, bio | |
| Services offered | Walking / sitting / boarding / daycare / grooming, etc. |
| Pricing | Per-hour and/or per-day, per service type |
| Availability calendar | Real-time, blocks out booked slots |
| Service location & radius | Or "boards at my home" vs "visits owner's home" |
| Home environment (for boarding) | Fenced yard, other pets present, smoking household, kids in home |
| Pet types/sizes accepted | Species and size restrictions |
| Experience & certifications | Pet first aid, vet tech background, years of experience |
| Background check status | Third-party verified (see §5) |
| Insurance/bonding status | |
| Reviews & rating | |
| Response rate/time | Marketplace health metric |
| Portfolio | Photos/updates from past bookings |

**Design decision to make early:** should Owner and Caretaker be two separate account types, or one `User` account that can hold both roles (like Airbnb host/guest)? The latter is more flexible and is what I'd recommend — someone may want to both list as a caretaker *and* book care for their own pet.

---

## 3. Core Workflow: Requesting Care

1. **Search** — Owner filters caretakers by location, date/time range, service type, price, pet size/species compatibility, rating.
2. **Request** — Owner selects a caretaker, specifies pet(s), dates/times, service type, and notes. Pet profile is auto-attached.
3. **Review & respond** — Caretaker sees the owner's profile + full pet profile (medical/behavioral notes included) and accepts, declines, or counters (e.g., different price/time).
4. **Confirm & pay** — On acceptance, payment is authorized (funds held, not captured — standard marketplace escrow pattern).
5. **Service window** — Optional live updates: check-in/check-out timestamps, photo updates, GPS-tracked walks.
6. **Completion** — Caretaker marks complete → payment captured → platform fee deducted → payout to caretaker.
7. **Review** — Both parties rate each other (bidirectional trust signal, like Uber/Airbnb).
8. **Cancellation policy** — Needs explicit rules (e.g., free cancellation >24h before, partial charge inside window) — decide this early since it affects the payment/escrow design.

---

## 4. Core Data Model

```
User (id, role_flags[owner, caretaker], name, email, phone, address, verified)
 ├── Pet (id, owner_id, name, species, breed, medical_info, behavior_notes...)
 ├── CaretakerProfile (id, user_id, services[], pricing, availability, radius...)
 ├── Booking (id, owner_id, caretaker_id, pet_id[], service_type, start, end,
 │            status[requested, accepted, declined, in_progress, completed, cancelled],
 │            price, payment_status)
 ├── Payment (id, booking_id, amount, platform_fee, status, provider_ref)
 ├── Review (id, booking_id, from_user_id, to_user_id, rating, comment)
 └── Message (id, booking_id, sender_id, body, timestamp)
```

Keep `Booking` as the central object — nearly every feature (chat, payment, review, cancellation) hangs off it.

---

## 5. Compliance & Trust/Safety (design in from day one)

These are much cheaper to plan for now than to retrofit:

- **Payments — PCI-DSS**: Never touch or store raw card numbers. Use a marketplace-payments provider (e.g., Stripe Connect) that handles split payments, escrow-style holds, and payouts to caretakers for you.
- **Data privacy — GDPR / CCPA**: If you'll have EU or California users, you need consent capture, a data export/deletion mechanism, and a documented lawful basis for storing pet medical data and location data.
- **Caretaker background checks**: Typically outsourced to a provider (e.g., Checkr, Sterling) rather than built in-house — this is a regulated, liability-heavy area.
- **Identity verification (KYC-style)**: For both trust and fraud prevention — providers like Stripe Identity or Persona handle document + selfie verification.
- **Liability**: You'll need Terms of Service clarifying that the platform is a marketplace facilitator, not the care provider — consult a lawyer on this before launch; it materially affects your insurance exposure.
- **Accessibility**: WCAG 2.1 AA is increasingly a legal requirement, not just best practice, especially in the US (ADA lawsuits) and EU.

---

## 6. High-Level Architecture (technology-agnostic for now)

```
[Web/Mobile Client]
        │
[API Layer]  ── Auth (JWT/OAuth) ── Rate limiting
        │
┌───────┼─────────────────────────────┐
│  Core Services                      │
│  - User/Profile service             │
│  - Booking/Availability service     │
│  - Payments (via provider SDK)      │
│  - Messaging (real-time)            │
│  - Notifications (push/SMS/email)   │
└───────┼─────────────────────────────┘
        │
[Database] + [Object storage for photos/docs] + [Search/geo index]
        │
[Third-party integrations: payments, background checks, ID verification, maps/geocoding]
```

### 6.1 Recommended Stack (experienced team, MVP-now / scale-later, web-first)

The guiding principle: **build a modular monolith, not microservices.** Microservices add operational overhead you don't need yet; a well-modularized monolith with clean boundaries between domains (users, bookings, payments, messaging) can be split into services later if/when a specific module needs to scale independently. This gets you fast now without painting you into a corner.

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | **Next.js + TypeScript + Tailwind** | SSR for SEO on caretaker/search pages, fast to build, huge ecosystem |
| Backend | **Node.js + TypeScript (NestJS)** | Structured modules map directly to your domain boundaries (Users, Bookings, Payments...); easy to extract a module into its own service later |
| API layer | **tRPC** (if FE/BE same team) or REST/OpenAPI if you want it consumable by a future mobile app without coupling to TS | tRPC = fastest dev velocity for a small team; REST/OpenAPI = safer long-term if a separate mobile team joins later |
| Database | **PostgreSQL** with **PostGIS** extension | Relational fits your entity model well (§4); PostGIS gives you proper geo radius search for "caretakers near me" instead of hacking it later |
| ORM | **Prisma** | Type-safe, fast to iterate, good migrations story |
| Auth | **Clerk** or **Auth0** (managed) | Don't hand-roll auth for a marketplace with sensitive data — buy this, it's a solved problem |
| Payments | **Stripe Connect** (Express accounts for caretakers) | Purpose-built for marketplaces: escrow-style holds, split payments, payouts, and it covers your PCI-DSS burden for you |
| File/image storage | **Cloudflare R2** or **S3** | Pet photos, vaccination docs |
| Real-time (chat, live booking status) | **Socket.io** or **Pusher** (managed, faster to ship) | |
| Background jobs (webhooks, notifications, reminders) | **BullMQ + Redis** | |
| Notifications | **Twilio** (SMS), **Postmark/SendGrid** (email) | |
| ID/background checks | **Stripe Identity** + **Checkr** | Outsource, don't build (§5) |
| Hosting | **Vercel** (frontend) + **Render or AWS ECS Fargate** (backend) + **Neon or RDS** (Postgres) | Minimal ops now, room to move to full AWS/K8s later without a rewrite |
| CI/CD | **GitHub Actions** | |
| Monitoring | **Sentry** (errors) + basic logging (add Datadog when you actually need it) | |

**One decision that pays off later:** even though you're web-only for now, structure the backend API so it's not Next.js–coupled (i.e., a separate NestJS API service, not API routes buried inside the Next.js app). That's what lets a React Native or Flutter mobile app plug into the same backend later with zero backend rework. If your team wants max velocity right now and is willing to accept a bit of future refactor risk, Next.js API routes / tRPC end-to-end is faster to ship — worth an explicit team decision rather than a default.

### 6.2 Suggested Build Phases

**Phase 1 — MVP (get a real booking to happen end-to-end)**
- Auth + Owner/Caretaker profiles + Pet profiles
- Caretaker search with basic location filter
- Booking request → accept/decline flow
- Stripe payment (manual capture on completion is fine to start — skip real escrow logic initially)
- Basic review system

**Phase 2 — Trust & retention**
- ID verification + background checks
- In-app messaging
- Ratings/response-rate surfaced in search ranking
- Cancellation policy enforcement

**Phase 3 — Scale & expand**
- Geo-optimized search (PostGIS radius queries, later Elasticsearch if search gets complex)
- Mobile app (consuming the same API)
- Recurring bookings
- Admin/ops dashboard for support & dispute handling

---

## 7. Open Questions for Next Iteration
- Escrow/cancellation policy specifics
- Do caretakers set fixed pricing or can owners negotiate?
- Recurring bookings (e.g., daily dog walker) vs. one-off only?
- In-app messaging required at MVP, or is email/SMS enough initially?
- Multi-pet bookings — single caretaker for owner's 3 pets at once?
