# SectionSync — Architecture & File Reference

This document maps every meaningful file in the project to what it does, which layer it belongs to, and what you would edit if you needed to change that thing.

---

## Project Structure at a Glance

```
Sectionsync/
├── client/                  ← All frontend code (React + TypeScript)
│   ├── pages/
│   │   ├── Index.tsx        ← Entire application UI (all screens)
│   │   └── NotFound.tsx     ← 404 page
│   ├── lib/
│   │   ├── section-sync-data.ts  ← Data models, types, seed data, business logic
│   │   ├── supabase.ts           ← Supabase client (unused in current demo mode)
│   │   ├── database.types.ts     ← Supabase DB type definitions
│   │   └── utils.ts              ← Tailwind class merge helper (cn())
│   ├── hooks/
│   │   ├── use-auth.ts           ← Auth hook (Supabase-based, not active in demo)
│   │   ├── use-section-sync.ts   ← React Query hooks for Supabase (not active in demo)
│   │   ├── use-mobile.tsx        ← Responsive breakpoint hook
│   │   └── use-toast.ts          ← Toast notification hook
│   ├── components/
│   │   └── ui/              ← shadcn/ui component library (pre-built, don't edit)
│   ├── App.tsx              ← React root: router, providers, QueryClient
│   ├── global.css           ← Global styles, design tokens, font imports
│   └── vite-env.d.ts        ← Vite env type declarations
│
├── api/                     ← Backend (Vercel serverless functions)
│   ├── send-otp.ts          ← POST /api/send-otp  — generates & emails OTP via Resend
│   └── verify-otp.ts        ← POST /api/verify-otp — checks OTP, returns ok/error
│
├── index.html               ← HTML shell (single entry point)
├── vite.config.ts           ← Vite dev server config (port 8080, /api proxy)
├── tailwind.config.ts       ← Tailwind theme (colours, fonts, spacing)
├── tsconfig.json            ← TypeScript compiler config
├── postcss.config.js        ← PostCSS / Tailwind pipeline
├── components.json          ← shadcn/ui config
├── vercel.json              ← Vercel deploy config (routes, build command)
├── .env                     ← Supabase placeholder keys (safe to commit)
├── .env.local               ← RESEND_API_KEY (gitignored — never commit)
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── DOCUMENTATION.md         ← User-facing feature documentation
└── ARCHITECTURE.md          ← This file
```

---

## 1. Frontend

### Entry points

| File | What it does |
|------|-------------|
| `index.html` | The single HTML file Vite serves. Has one `<div id="root">` and loads `client/App.tsx` as an ES module. |
| `client/App.tsx` | Mounts the React app. Sets up `QueryClientProvider`, `TooltipProvider`, `BrowserRouter`, and the two routes (`/` → `Index`, `*` → `NotFound`). |

### The main app — `client/pages/Index.tsx`

This is the largest file (~1 800 lines) and contains **the entire application UI**. It is split into clearly labelled sections:

| Section | Lines (approx.) | What to edit here |
|---------|----------------|-------------------|
| Imports | top | Add/remove icon imports, data imports |
| Types | ~45–62 | `Session`, `Toast`, `AdminPage`, `StudentPage` types |
| OTP helpers | ~63–115 | `requestOtp()`, `confirmOtp()` — swap demo fallback for real API calls here |
| Constants | ~118–145 | `PHASE_LABELS`, `SPEC_PALETTE` colour array |
| UI primitives | ~148–190 | `Badge`, `Card`, `Btn`, `Input`, `PhaseBanner` — tweak design tokens here |
| `LoginScreen` | ~193–445 | Login page, OTP screen, demo quick-access buttons |
| `AppShell` | ~448–540 | Fixed sidebar + header + scrollable main layout |
| `AdminDashboard` | ~543–610 | Admin home stats and specialization breakdown |
| `AdminSpecializations` | ~613–720 | Add / edit / toggle / remove specializations (dynamic, not hard-coded) |
| `AdminSpecWindow` | ~723–780 | Open/close specialization selection window |
| `AdminSections` | ~783–870 | Review and adjust auto-generated sections |
| `AdminSectionWindow` | ~873–920 | Open/close section-selection window |
| `AdminStudents` | ~923–990 | Read-only student table with filters |
| `AdminStudentList` | ~993–1 280 | Upload Excel/PDF/CSV, add/edit/remove students, pagination |
| `AdminAccessManagement` | ~1 283–1 380 | Add/remove authorized admin emails |
| `StudentDashboard` | ~1 383–1 440 | Student home with progress tracker |
| `StudentSpecSelection` | ~1 443–1 510 | Student specialization pick screen |
| `StudentSectionSeat` | ~1 513–1 740 | Theatre-style seat map + section roster |
| Root `Index` component | ~1 743–1 810 | Wires everything together, holds all state |

### Data model — `client/lib/section-sync-data.ts`

All types and seed data live here. Edit this file to:

- Change the **student seed data** (roll number prefix, batch year, names)
- Add fields to `Student`, `Section`, or `SpecializationDef`
- Change the **50-students-per-section** target capacity (`TARGET_CAPACITY` constant)
- Change the **default admin emails** (`createAdminUsers()`)
- Change **default specializations** (`createDefaultSpecializations()`)

Key exports:

| Export | Purpose |
|--------|---------|
| `SpecializationDef` | Interface for a dynamic specialization |
| `Student` | Interface for an authorized student |
| `Section` | Interface for an auto-generated section |
| `AdminUser` | Interface for an authorized admin |
| `AppState` | Root state object held in React `useState` |
| `AppPhase` | Union type for the 5 system phases |
| `computeSectionCapacities(count)` | Returns array of seat counts per section given a student count |
| `autoCreateSections(students, specs)` | Creates sections for all active specs based on student counts |
| `takenSeats(section, students)` | Returns array of taken seat numbers for a section |
| `createStudents()` | Seed: 120 4th-year students (22CSU001–22CSU120) |
| `createAdminUsers()` | Seed: two authorized admins |
| `createDefaultSpecializations()` | Seed: 5 default specializations |
| `createInitialData()` | Returns the full initial `AppState` |

### Styles — `client/global.css` and `tailwind.config.ts`

| File | What to change |
|------|---------------|
| `client/global.css` | Font imports (DM Sans, Space Grotesk), CSS custom properties (colours, sidebar width) |
| `tailwind.config.ts` | Design tokens: `ink` (dark), `lime` (#d8ff5b accent), `paper` (background), border radius, font families |

### Passive files (don't need to touch for features)

- `client/lib/utils.ts` — just `cn()` (Tailwind class merger)
- `client/components/ui/*` — shadcn/ui library components, pre-built
- `client/hooks/use-auth.ts` — Supabase auth hook, not wired in the current demo
- `client/hooks/use-section-sync.ts` — Supabase data hooks, not wired in the current demo
- `client/lib/supabase.ts` — Supabase client, inactive in demo mode

---

## 2. Backend

The backend is **two Vercel serverless functions**. They run on the server — the browser never sees the Resend API key.

### `api/send-otp.ts` — POST `/api/send-otp`

**What it does:**
1. Receives `{ email }` in the POST body
2. Generates a random 6-digit OTP
3. Stores it in an in-process `Map` with a 10-minute TTL
4. Sends the OTP to the email address via the **Resend** API
5. Returns `{ ok: true }` or `{ error: "..." }`

**Edit this file to:**
- Change the OTP email template (HTML)
- Change the "from" sender address (`noreply@sectionsync.app`)
- Change OTP length or expiry time
- Swap Resend for another email provider (SendGrid, Nodemailer, etc.)
- Add rate limiting (e.g. max 3 OTP requests per email per 10 minutes)

**Required environment variable:**
```
RESEND_API_KEY=re_your_key_here   (in .env.local for dev, Vercel dashboard for prod)
```

### `api/verify-otp.ts` — POST `/api/verify-otp`

**What it does:**
1. Receives `{ email, otp }` in the POST body
2. Calls `consumeOtp()` from `send-otp.ts` (shared in-process store)
3. Returns `{ ok: true }` on success or `{ error: "..." }` for wrong/expired/not-found

**Edit this file to:**
- Add brute-force protection (attempt counter — already started in `send-otp.ts`)
- Log auth events
- Add IP-based rate limiting

### Local development without Vercel CLI

When `pnpm dev` runs without `vercel dev` alongside it, the frontend's `requestOtp()` / `confirmOtp()` calls will get a network error (no `/api` handler). The code **automatically falls back to a client-side OTP simulation** — the OTP is generated in the browser and shown as a "Demo OTP" hint. This is intentional for local testing without configuring Resend.

To use real OTP emails locally:
1. Add `RESEND_API_KEY` to `.env.local`
2. Run `vercel dev` in one terminal (starts API on port 3000)
3. Run `pnpm dev` in another (Vite on port 8080, proxies `/api` → 3000)

---

## 3. Security

### What is protected

| Concern | How it's handled |
|---------|-----------------|
| API key exposure | `RESEND_API_KEY` only exists in `.env.local` (gitignored) or Vercel env vars — never in the frontend bundle |
| No open registration | Login checks email against the admin-uploaded list before sending any OTP |
| Student domain enforcement | Any email not ending in `@ncuindia.edu` is rejected at the login step |
| Admin list separation | Admin and student email lists are kept separate; adding a student email as admin is blocked |
| OTP expiry | OTPs expire after 10 minutes; consumed on first successful use (single-use) |
| Brute-force guard | `consumeOtp()` deletes the entry after 5 failed attempts |
| Self-removal protection | An admin cannot remove their own access from the admin panel |
| Specialization deletion guard | A specialization cannot be deleted if students have already selected it |

### What is NOT yet in place (future work)

| Gap | Recommended fix |
|-----|----------------|
| In-process OTP store | Single-instance only. For multi-instance production, replace the `Map` in `api/send-otp.ts` with **Vercel KV** (Redis) |
| Rate limiting on `/api/send-otp` | Add Vercel Edge middleware or an in-memory rate limiter per IP/email |
| Admin authentication | Admins currently log in with email only (no OTP). Add OTP for admins too before production |
| Audit log | No record of who changed what. Add a simple log array to `AppState` or a server-side table |
| HTTPS | Handled automatically by Vercel on deployment. Not relevant for localhost |
| State persistence | All data is in React `useState` — it resets on page refresh. Needs a database (Supabase tables are already scaffolded) |

### Files that touch security

| File | Security role |
|------|--------------|
| `api/send-otp.ts` | OTP generation, storage, email dispatch, brute-force guard |
| `api/verify-otp.ts` | OTP consumption and validation |
| `client/pages/Index.tsx` → `LoginScreen` | Email validation, domain check, student list lookup |
| `client/pages/Index.tsx` → `AdminAccessManagement` | Admin list management, overlap prevention, self-removal block |
| `client/lib/section-sync-data.ts` → `createAdminUsers()` | Hardcoded initial admin emails |
| `.env.local` | Holds `RESEND_API_KEY` — gitignored, never committed |
| `.gitignore` | Covers `.env.*` pattern — ensures secrets stay local |

---

## 4. Deployment (Vercel)

### Files involved

| File | Purpose |
|------|---------|
| `vercel.json` | Tells Vercel: build with `pnpm build`, serve from `dist/spa`, send all non-API routes to `index.html` (SPA routing), let `/api/*` routes hit the serverless functions |
| `vite.config.ts` | `build.outDir: "dist/spa"` matches `vercel.json`'s `outputDirectory` |
| `api/*.ts` | Vercel auto-detects TypeScript files in `/api` as serverless functions |
| `.env.local` | Local only — create matching env vars in Vercel dashboard for production |

### Steps to deploy

1. Push the repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Vercel will auto-detect the config from `vercel.json`
4. Add environment variable in Vercel dashboard:
   - Key: `RESEND_API_KEY`
   - Value: your Resend API key
5. Set "From" address in `api/send-otp.ts` to a domain you own and have verified in Resend
6. Deploy

### Before going live — checklist

- [ ] Remove the "Demo quick access" section from `LoginScreen` in `Index.tsx`
- [ ] Remove the `demoOtp` state and the demo OTP hint box
- [ ] Remove the client-side OTP fallback in `requestOtp()` / `confirmOtp()`
- [ ] Add OTP for admin login (not just direct email access)
- [ ] Replace in-process `Map` in `api/send-otp.ts` with Vercel KV for multi-instance safety
- [ ] Verify your sender domain in Resend
- [ ] Set `RESEND_API_KEY` in Vercel environment variables
- [ ] Test end-to-end with a real `@ncuindia.edu` email

---

## 5. Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` / `react-dom` | 18 | UI framework |
| `vite` | 8 | Dev server and build tool |
| `typescript` | 7 | Static typing |
| `tailwindcss` | 4 | Utility CSS |
| `xlsx` | 0.18.5 | Excel/CSV parsing for student list upload |
| `pdfjs-dist` | 4.4.168 | PDF text extraction for student list upload |
| `resend` | 4.x | Email sending for real OTP delivery |
| `@vercel/node` | latest | Types for Vercel serverless function handlers |
| `react-router-dom` | 6 | Client-side routing |
| `@tanstack/react-query` | 5 | Data fetching hooks (scaffolded, not active in demo) |
| `@supabase/supabase-js` | 2.50.5 | Database client (scaffolded, not active in demo) |
| `lucide-react` | latest | Icons |
| `framer-motion` | 12 | Animation |

---

*SectionSync · NCU 4th Year CSE · Architecture Reference v1.0*
