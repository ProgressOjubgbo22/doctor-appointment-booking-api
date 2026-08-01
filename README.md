# Appointment Booking System (Backend)

A full-featured Node.js / Express / MongoDB backend for a hospital doctor
appointment booking platform, supporting three roles: **Patient**, **Doctor**,
and **Admin**.

## Features

- **Auth**: register, login, logout, JWT access + refresh tokens (rotated on
  refresh), email verification, forgot/reset password, change password.
- **Patients**: profile, medical info, emergency contacts, addresses, favorite
  doctors, dashboard stats, medical records, prescriptions, appointment
  history.
- **Doctors**: profile, consultation fee, weekly availability with break
  times, blocked/unavailable dates, appointment queue management (accept /
  reject / check-in / complete / no-show), prescriptions, medical records,
  earnings dashboard.
- **Admin**: dashboard analytics, patient & doctor account management
  (suspend/activate/deactivate), doctor onboarding + license verification,
  appointment oversight (create/cancel/reschedule/reassign), specialty
  management, revenue/appointment/doctor/patient reports, audit log, system
  announcements.
- **Booking engine**: slot generation from doctor availability minus break
  time and already-booked appointments, conflict checking, full appointment
  lifecycle state machine (`pending → confirmed → checked_in → in_progress →
  completed`, plus `cancelled`, `no_show`, `rescheduled`).
- **Payments**: Stripe Checkout for card payments, cash-at-visit flow,
  refunds, invoices.
- **Reviews**: 1 review per completed appointment, doctor rating
  auto-recalculated, admin moderation.
- **Notifications**: in-app notifications for every major lifecycle event.
- **Audit log**: every administrative action is recorded.

## Tech Stack

Express · MongoDB/Mongoose · JWT · bcrypt · Zod (validation) · Multer +
Cloudinary (file uploads) · Nodemailer (email) · Stripe (payments) · Helmet +
express-rate-limit (security).

## Project Structure

```
config/         # DB, Cloudinary, Stripe setup
models/         # Mongoose schemas (matches the ERD)
validators/     # Zod request-validation schemas
middleware/     # auth, role guard, validation, upload, error handling
controllers/    # business logic, one file per domain
routes/         # Express routers, one file per domain
utils/          # helpers (tokens, email, slot generation, notifications, audit log, seed)
app.js          # Express app (middleware + route wiring)
server.js       # entrypoint (DB connection + listen)
```

## Getting Started

```bash
npm install
cp .env.example .env   # fill in your own secrets (Mongo URI, JWT secrets, SMTP, Cloudinary, Stripe)
npm run seed            # creates the admin account + default specialties
npm run dev              # starts on http://localhost:5000 (nodemon)
```

Health check: `GET /health`

Default admin login (from `.env` `ADMIN_EMAIL` / `ADMIN_PASSWORD`, seeded by
`npm run seed`): use `POST /api/auth/login`.

## Adding a Doctor

Doctors can't self-register. An admin invites a doctor via
`POST /api/admin/doctors`, which:

1. Creates the `User` + `Doctor` records with a random temporary password
   and `verificationStatus: pending`.
2. Creates a `VerificationToken` (`type: "doctor_setup"`, 72-hour expiry)
   and emails the doctor a link:
   `{CLIENT_URL}/doctor/setup-account?token=<token>`.

The doctor then finishes onboarding themselves by calling:

- **`POST /api/auth/accept-invitation`** — body `{ token, password }`.
  Verifies the token, lets the doctor set their own password in place of
  the temp one, marks their email verified, activates the account if it
  was still `pending`, and logs them straight in (returns the same
  `{ user, accessToken, refreshToken }` shape as `POST /api/auth/login`).
  An expired or already-used token returns a clear `400` so the frontend
  can prompt them to ask an admin to resend the invite.

The admin then still needs to review the doctor's license/qualifications
and call `PATCH /api/admin/doctors/:id/approve` (or `/verify`) before the
doctor appears in patient-facing search and can accept appointments -
accepting the invitation only lets them log in, it doesn't verify their
credentials.

## Booking Flow (happy path)

1. Patient browses `GET /api/doctors` / `/api/doctors/search`.
2. Patient checks open slots: `GET /api/doctors/:id/availability?date=YYYY-MM-DD`.
3. Patient books: `POST /api/appointments` → creates `Appointment` (status
   `pending`) + a matching `Payment` record.
4. Doctor accepts/rejects: `PATCH /api/appointments/:id/accept` or `/reject`.
5. On visit day: `PATCH /api/appointments/:id/check-in` →
   `.../complete`. Cash payments are marked paid automatically on
   completion; card payments go through Stripe Checkout via
   `POST /api/payments`.
6. Doctor issues a prescription (`POST /api/prescriptions`) and/or a medical
   record (`POST /api/medical-records`) — both require the appointment to
   have been seen already.
7. Patient can leave a review once the appointment is `completed`:
   `POST /api/reviews`.

Cancellations, reschedules, no-shows, and admin overrides (create on behalf
of a patient, reassign to another doctor, etc.) are handled by their
corresponding endpoints under `/api/appointments/*` and `/api/admin/*`.

## API Overview

All endpoints are namespaced under `/api`. Auth uses either an `Authorization:
Bearer <token>` header or the `accessToken` httpOnly cookie set on login.

| Domain | Base path | Notes |
|---|---|---|
| Auth | `/api/auth` | public + `/me`, `/change-password` (auth required) |
| Patients | `/api/patients` | patient-only |
| Doctors (public) | `/api/doctors` | browsing, availability, reviews — public |
| Doctor (self-service) | `/api/doctor` | doctor-only |
| Appointments | `/api/appointments` | role-gated per action |
| Prescriptions | `/api/prescriptions` | doctor writes, patient/doctor read |
| Medical Records | `/api/medical-records` | doctor writes, patient/doctor read |
| Payments | `/api/payments` | patient pays, admin/doctor refund |
| Reviews | `/api/reviews` | public read, patient write |
| Notifications | `/api/notifications` | auth required |
| Specialties | `/api/specialties` | public read, admin write |
| Reports | `/api/reports` | admin-only |
| Audit Logs | `/api/audit-logs` | admin-only |
| Admin | `/api/admin` | admin-only, patient/doctor/appointment management |

This mirrors the endpoint list in the original specification; see the
controllers for exact request/response shapes.

## Stripe Webhook

Card payments are confirmed two ways: the client can call `POST
/api/payments/verify` right after checkout, and Stripe also calls your
server directly so payment status stays correct even if the user closes
their browser before returning.

- **Endpoint**: `POST /api/payments/webhook`
- **Handler**: lives in `controllers/payment.controller.js`
  (`handleStripeWebhook`), alongside the rest of the payment logic it
  updates — not a separate module.
- **Handles**: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `charge.refunded`. On a successful payment it also auto-confirms the
  linked appointment if it was still `pending`.
- This route is mounted directly in `app.js` (`app.post("/api/payments/webhook", express.raw(...), handleStripeWebhook)`)
  **before** the global `express.json()` middleware — Stripe signs the raw
  request body, so it must never be JSON-parsed first or signature
  verification will fail. It intentionally bypasses the normal
  `/api/payments` router since it's called by Stripe, not an authenticated
  client.

Local testing with the Stripe CLI:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET in your .env
stripe trigger checkout.session.completed
```

In production, add the same endpoint URL (`https://yourdomain.com/api/payments/webhook`)
in the Stripe Dashboard → Developers → Webhooks, and copy the signing
secret it gives you into `STRIPE_WEBHOOK_SECRET`.

## Patient ↔ Doctor History

- **Doctor sees a patient's history**: `GET /api/doctor/patients` lists every
  patient who has ever booked with the logged-in doctor (with last visit +
  total visit count). `GET /api/doctor/patients/:patientId` returns that
  patient's full profile, every appointment they've had with this doctor,
  and their complete medical record / prescription trail (including entries
  from other doctors, for continuity of care). `GET
  /api/doctor/patients/:patientId/dashboard` is a richer single-screen
  version scoped to just this doctor's own encounters with the patient
  (appointments, records, prescriptions, attached reports, and the
  patient's review if any). Access to both is only granted once the
  patient has actually had at least one appointment with that doctor.
- **Patient sees their history with a doctor**:
  `GET /api/patients/doctors/:doctorId/history` returns that doctor's
  profile plus every appointment, prescription, and medical record the
  patient has from that specific doctor, and the patient's own review of
  them if one exists.
- **Doctor sees their own reviews**: `GET /api/doctor/reviews` returns every
  review left for the logged-in doctor plus their current average rating.

## Admin Reporting

- `GET /api/admin/doctors/:id/performance` — appointment counts by status,
  completion/cancellation/no-show rates, total revenue + refunds, average
  rating, and prescriptions issued for one doctor.
- `GET /api/admin/patients/:id/dashboard` — one patient's full picture:
  profile, recent appointments, payments, medical records, prescriptions,
  reviews, and notifications. This is a PHI-access endpoint and is
  audit-logged every time it's called.

## Browsing by Specialty

`GET /api/specialties/:id/doctors` — public endpoint listing verified,
active doctors for one specialty (404s if the specialty doesn't exist).

## Editing Windows & Data Integrity Rules

- **Reviews**: a patient can edit or delete their own review for **48
  hours** after posting it (`REVIEW_EDIT_WINDOW_HOURS` in
  `controllers/review.controller.js`). After that, the review is locked —
  ask an admin to moderate it instead.
- **Prescriptions**: a doctor can edit a prescription only until **whichever
  comes first**: the patient views/downloads it, or 24 hours pass since it
  was issued (`PRESCRIPTION_EDIT_WINDOW_HOURS` in
  `controllers/prescription.controller.js`). This prevents a prescription
  from silently changing after a patient has already acted on it, while
  still allowing quick typo/dosage fixes right after writing it.
  Cancellation is intentionally **not** subject to this window — a doctor
  must always be able to cancel a prescription (e.g. an adverse reaction
  discovered later), regardless of whether the patient has already seen it.

## Audit Logging

Every security- or PHI-relevant action writes an entry to `AuditLog`
(`utils/createAuditLog.js`), retrievable via `GET /api/audit-logs`
(admin-only). This currently covers: login (success + failed attempts),
logout, password change/reset, appointment lifecycle transitions (accept,
reject, cancel, reschedule, check-in, complete, no-show), prescription
create/update/cancel, review update/delete, payment creation/refunds
(including ones triggered by the Stripe webhook), admin account management
actions (suspend/activate/verify/etc.), and admin/doctor PHI-access views
(patient dashboards). If you add new sensitive routes, call
`createAuditLog({ req, action, entityName, entityId, description })` from
the controller the same way the existing ones do.

## Notes & Assumptions

- Prescription/invoice "download" endpoints (`GET /api/prescriptions/:id/download`,
  `GET /api/payments/invoices/:id`) stream a real, branded PDF generated
  server-side with `pdfkit` (see `utils/generatePdf.js`) — no client-side
  rendering needed. Edit the hospital name/address/branding constants at the
  top of that file to match your hospital.
- Slot duration defaults to 30 minutes (`utils/generateSlots.js`) — change
  `slotDurationMinutes` there if your hospital books in different
  increments.
- No-show payment policy is left intentionally simple (no auto-refund) —
  adjust `markNoShow` in `controllers/appointment.controller.js` for your
  hospital's cancellation policy.
- Email sending fails silently (logged, not thrown) so a flaky SMTP
  provider never blocks a booking — check server logs if emails aren't
  arriving.
