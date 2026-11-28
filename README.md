# SectionSync

Section and specialization management portal for 2nd-year CSE students at NCU.

Built with React, TypeScript, Supabase (PostgreSQL + Realtime), and Vercel serverless functions.

---

## What it does

Admins upload a student list, open a specialization-selection window, finalize sections, then open a section-selection window. Students log in, pick their specialization, choose a section and seat, and self-assign a lab group. Everything persists in a live database with real-time updates across all sessions.

### Admin
- Upload students via Excel / CSV / PDF
- Manage specializations (add, edit, toggle active)
- Control spec and section windows — open for all students or new students only
- Auto-generate sections (target 50/section), adjust capacities, finalize
- Assign lab groups (G1/G2) on window close, with student self-selection before that
- Export final allocation as Excel
- Real-time visibility of every student selection

### Student
- Pick specialization when window is open
- Choose section and seat from a live seat map (taken seats update in real time)
- Self-select lab group (G1/G2) based on available capacity
- Send, accept, or reject section swap requests with other students
- Dashboard shows current section and group at a glance

---

## Tech stack

| Layer | Technology |
|-------|----------|
| Frontend | React 18, TypeScript, Tailwind CSS |
| Backend | Vercel serverless functions (Node.js) |
| Database | Supabase (PostgreSQL) with Row Level Security |
| Realtime | Supabase Realtime (postgres_changes) |
| Auth | Supabase Auth — password-based, JWT |
| Deploy | Vercel |

---

## API endpoints

| Method | Route | Who | Purpose |
|--------|-------|-----|---------|
| POST | /api/sign-in | All | Authenticate, return JWT |
| PUT | /api/change-password | All | Update own password |
| GET/POST/PUT/DELETE | /api/admin-students | Admin | Student CRUD |
| GET/POST/PUT/DELETE | /api/admin-specializations | Admin | Specialization CRUD |
| GET/POST/PUT/DELETE | /api/admin-sections | Admin | Section CRUD |
| GET/PUT/POST | /api/admin-config | Admin | Phase/window control, section auto-create |
| GET/POST/DELETE | /api/admin-admins | Admin | Admin access management |
| POST | /api/student-spec | Student | Save specialization selection |
| POST | /api/book-seat | Student | Atomic seat booking |
| POST | /api/student-group | Student | Save group selection |
| GET/POST/PUT | /api/student-swaps | Student | Swap request lifecycle |

---

## Database schema

Core tables: admins, system_config, specializations, sections, students, seats, swap_requests, rate_limit_log

RLS is enabled on all tables. Students can read their own row plus a safe student_peers view (no email/auth_id) for section-mate visibility. All writes go through API functions using the service role key.

Atomic seat booking runs inside a PostgreSQL function book_seat() that uses SELECT FOR UPDATE NOWAIT to prevent race conditions under concurrent load.

---

## Local development

Install dependencies with: pnpm install

Run vercel dev in one terminal (API on port 3000), then in another terminal run the Vite dev server on port 8080 which proxies /api requests to 3000.

Environment variables needed in .env.local:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

---

## Database setup

Run supabase/migration.sql in the Supabase SQL editor. It creates all tables, RLS policies, indexes, the book_seat() function, and the student_peers view.
