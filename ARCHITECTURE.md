# SectionSync — Architecture Reference

---

## Project structure

    Sectionsync/
    client/pages/Index.tsx          Entire application UI
    client/lib/section-sync-data.ts Data types, AppState, helper functions
    client/lib/supabase.ts          Supabase anon client (realtime + RLS reads)
    api/_supabase-admin.ts          Supabase service-role client (server-side only)
    api/_utils.ts                   Shared: CORS, rate limiting, admin verification
    api/sign-in.ts                  POST /api/sign-in
    api/change-password.ts          PUT  /api/change-password
    api/admin-students.ts           CRUD /api/admin-students
    api/admin-specializations.ts    CRUD /api/admin-specializations
    api/admin-sections.ts           CRUD /api/admin-sections
    api/admin-config.ts             Phase/window control + section auto-create
    api/admin-admins.ts             Admin access management
    api/book-seat.ts                POST /api/book-seat (atomic, race-safe)
    api/student-spec.ts             POST /api/student-spec
    api/student-group.ts            POST /api/student-group
    api/student-swaps.ts            GET/POST/PUT /api/student-swaps
    supabase/migration.sql          Full DB schema, RLS, functions, indexes

---

## Authentication

Password-based via Supabase Auth. /api/sign-in authenticates with the Supabase admin API, checks the admins table to determine role, and returns a JWT. The client stores the session via supabase.auth.setSession().

Students use their NCU email and a default password (rollnumber@1234). All API routes verify the JWT and check role before doing anything.

---

## State management

All UI state lives in a single useState<AppState> in the root Index component. No Redux or Zustand.

On admin login: student list + sections + config loaded in parallel, all awaited before first render — no flash.
On student login: own record + sections + peers (via student_peers view) loaded in parallel.

Realtime subscriptions (Supabase postgres_changes):
- Admins subscribe to the students table — any update reflects immediately
- Students subscribe to students filtered by specialization — seat map stays live
- Students on the swap page subscribe to swap_requests — incoming requests appear instantly

---

## Database

PostgreSQL via Supabase. RLS enabled on all tables.

admins                Authorized admin emails
system_config         Single-row global phase and window flags
specializations       Dynamic specialization definitions
sections              Sections per specialization with capacity
students              Student records with section/seat/group assignments
seats                 One row per physical seat — atomic uniqueness guard for booking
swap_requests         Section swap request lifecycle
rate_limit_log        Per-email and per-IP rate limiting log

student_peers view: safe read-only projection of students (no email/auth_id) that all authenticated users can query. Used by students to see section-mates for the seat map and swap targets.

---

## Seat booking (race condition prevention)

Booking runs inside a PostgreSQL function book_seat(p_student_id, p_section_id, p_seat_number):

1. Checks the section window is open
2. Locks the student row with SELECT FOR UPDATE
3. Validates specialization match and seat range
4. Tries to lock the seat row with SELECT FOR UPDATE NOWAIT — returns seat_taken immediately if another transaction holds it
5. Releases any previous seat this student held
6. Upserts the new seat claim
7. Updates the student record

Returns a text result code (ok, seat_taken, window_closed, etc.). The API maps these to HTTP status codes.

---

## Section window modes

Both the spec window and section window can be opened in two modes:

- All students: everyone can select or change their choice
- New students only: only students without an existing selection can act

Controlled by spec_window_new_only and section_window_new_only flags in system_config. All three student-facing APIs (student-spec, book-seat, student-group) check these flags.

When closing the spec window, sections are created in top-up mode — existing sections preserved, new ones only created if existing capacity is insufficient.

---

## Security

Auth              Supabase JWT verified server-side on every API call
Role separation   Admin routes call verifyAdmin() which checks the admins table
RLS               Students read only their own row; bulk reads use service role in API
Rate limiting     Per-email and per-IP limits on every route via rate_limit_log
Secret isolation  SUPABASE_SERVICE_ROLE_KEY only in API functions, never in client bundle
Seat races        Handled at DB level with FOR UPDATE NOWAIT
Input validation  All API routes validate body fields before any DB operation

---

## Build

Vite with code splitting. XLSX and PDF are dynamically imported — only downloaded when an admin uses upload or export.

react-vendor      react, react-dom          ~54 kB gzip
supabase-vendor   @supabase/supabase-js     ~31 kB gzip
ui-vendor         lucide-react               ~3 kB gzip
index             App code                  ~72 kB gzip
xlsx (lazy)       XLSX library             ~144 kB gzip
pdf (lazy)        pdfjs-dist                ~92 kB gzip
