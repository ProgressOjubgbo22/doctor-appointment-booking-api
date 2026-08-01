# City Care Hospital — Appointment Booking System (Backend)

A full-featured Node.js / Express / MongoDB backend for a hospital doctor
appointment booking platform, supporting three roles: **Patient**, **Doctor**,
and **Admin**.

> Replace "City Care Hospital" with your actual hospital's name/branding
> wherever it appears (`utils/seed.js`, `controllers/auth.controller.js`,
> `controllers/admin.controller.js`, email templates).

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
`POST /api/admin/doctors`, which creates the account, sends a setup email, and
marks them `verificationStatus: pending`. The admin then reviews their
license/qualifications and calls `PATCH /api/admin/doctors/:id/approve` (or
`/verify`) before the doctor can appear in patient-facing search and accept
appointments.

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

## Notes & Assumptions

- Prescription/invoice "download" endpoints return structured JSON rather
  than generating a PDF server-side — wire this into your preferred PDF
  renderer (e.g. `pdfkit`) or have the frontend render/print it. This keeps
  the backend dependency-light; swap in a PDF generator if you need a binary
  file response.
- Slot duration defaults to 30 minutes (`utils/generateSlots.js`) — change
  `slotDurationMinutes` there if your hospital books in different
  increments.
- No-show payment policy is left intentionally simple (no auto-refund) —
  adjust `markNoShow` in `controllers/appointment.controller.js` for your
  hospital's cancellation policy.
- Email sending fails silently (logged, not thrown) so a flaky SMTP
  provider never blocks a booking — check server logs if emails aren't
  arriving.
