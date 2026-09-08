# SectionSync — System Documentation

**NCU 4th Year CSE · Section & Specialization Management Portal**

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Authentication](#2-authentication)
3. [Overall Flow](#3-overall-flow)
4. [Admin Features](#4-admin-features)
5. [Student Features](#5-student-features)
6. [UI Layout](#6-ui-layout)
7. [Data Model](#7-data-model)
8. [File Upload Formats](#8-file-upload-formats)
9. [System Phases](#9-system-phases)
10. [Key Rules & Constraints](#10-key-rules--constraints)

---

## 1. System Overview

SectionSync is a web portal that manages the specialization selection, section creation, and seat allocation process for 4th-year CSE students at NCU. The system is designed to be **batch-agnostic** — the admin uploads a fresh student list for each academic year without any code changes.

The system has two user roles:

| Role | Access |
|------|--------|
| **Admin** | Full control over windows, specializations, sections, student data, and admin access |
| **Student** | Can select specialization, choose a section, and pick a seat when windows are open |

---

## 2. Authentication

### Admin Login

- Only **pre-authorized email addresses** can log in as admins.
- Current authorized admin emails:
  - `manvibreja@ncuindia.edu` — Primary admin
  - `kumkum33517@gmail.com` — Team member
- Admins log in by entering their email. If the email is in the admin list, access is granted immediately (no OTP in demo mode).
- No public admin registration exists. Even knowing the URL is not enough to access the admin panel.
- Additional admins can be added from the **Admin Access** page (subject to overlap checks with the student list).

### Student Login

Authentication flow:

```
Student enters email
  → System checks @ncuindia.edu domain
  → System checks if email exists in admin-uploaded student list
  → If found: OTP sent to that email
  → Student enters 6-digit OTP (valid for 10 minutes)
  → Logged in
```

- Only students whose email addresses are in the uploaded list can log in.
- No self-registration. Students cannot create accounts.
- Student emails **must** end with `@ncuindia.edu`.
- OTP is 6 digits, expires in 10 minutes, and is single-use.
- A resend option is available on the OTP screen.

> **Demo mode:** The generated OTP is displayed on screen since there is no live email server in this build.

---

## 3. Overall Flow

```
Admin adds/activates Specializations
        ↓
Admin opens Specialization Selection Window
        ↓
Students choose their Specialization
        ↓
Admin closes the Specialization Window
        ↓
System automatically calculates student counts per specialization
        ↓
System automatically creates required number of sections
  (target: ~50 students per section)
        ↓
Admin reviews section distribution
Admin can manually adjust section capacities
        ↓
Admin clicks "Finalize Sections"
        ↓
Admin opens Section Selection Window
        ↓
Students choose their Section
Students choose their Seat (theatre-style map)
        ↓
Admin closes Section Selection Window
        ↓
Process complete
```

---

## 4. Admin Features

### 4.1 Dashboard

- Overview statistics: total authorized students, specialization selections count, sections created, seats taken.
- Live specialization breakdown bar chart showing how many students selected each specialization.
- Auto-preview of how many sections would be created per specialization based on current selections.
- Current system phase indicator at the top.

---

### 4.2 Specialization Management

Location: **Sidebar → Specializations**

Specializations are **fully dynamic** — not hard-coded. The admin controls exactly which specializations students see.

**What the admin can do:**

| Action | Description |
|--------|-------------|
| **Add** | Create a new specialization with name, batch/year, description, and active status |
| **Edit** | Update the name, batch, description, or active status of any existing specialization |
| **Toggle active/inactive** | Inactive specializations are hidden from the student selection screen immediately |
| **Remove** | Delete a specialization (only allowed if no student has already selected it) |

**Fields per specialization:**

| Field | Required | Notes |
|-------|----------|-------|
| Name | Yes | Must be unique |
| Batch / Academic year | Yes | e.g. `2024-25` — shown as a badge to students |
| Description | No | Short text shown to students on the selection card |
| Active | Yes | Toggle — only active specs appear in the student portal |

**Why this matters:** A new specialization introduced for a future batch can be added directly from the admin panel. No code changes required.

---

### 4.3 Specialization Window

Location: **Sidebar → Spec window**

Controls whether students can choose their specialization.

| State | Effect |
|-------|--------|
| **Open** | Students can visit the specialization selection page and choose/change their specialization |
| **Closed** | Student selection page is locked; sections are auto-generated at the moment of closing |

**Closing the window:**
- Requires at least one student to have made a selection.
- Requires at least one active specialization to exist.
- **Automatically triggers section generation** based on current student counts.
- Section creation formula: `ceil(studentCount / 50)` sections per specialization, with seats distributed as evenly as possible.

**Examples:**
- 52 students → 1 section (52 seats)
- 100 students → 2 sections (50 + 50 seats)
- 101 students → 3 sections (34 + 34 + 33 seats)

The window can be **reopened** if needed (this clears generated sections and resets to the open state).

---

### 4.4 Section Management

Location: **Sidebar → Sections**

After the specialization window is closed, the admin reviews the auto-generated sections here.

**What the admin can do:**

| Action | Description |
|--------|-------------|
| **View** | See all sections grouped by specialization, with capacity and current occupancy |
| **Adjust capacity** | Manually change the capacity of any section (e.g. split 52 into 30+22) |
| **Finalize** | Lock the sections and move the system to the next phase |

**Capacity mismatch warning:** If the total capacity across sections for a specialization differs from the number of students who selected it, a warning is shown in red.

**Finalize:** Once the admin is satisfied, clicking "Finalize sections" advances the system phase and enables opening the section-selection window.

---

### 4.5 Section Selection Window

Location: **Sidebar → Section window**

Controls whether students can choose their section and seat.

| State | Effect |
|-------|--------|
| **Open** | Students can visit the section/seat page and pick their spot |
| **Closed** | No new section or seat selections can be made |

- Can only be opened **after** sections are finalized.
- Can be opened and closed multiple times.
- Shows a live count of how many students have chosen a seat vs. the total.

---

### 4.6 All Students View

Location: **Sidebar → All students**

A read-only table of all students with their current state.

**Columns:** Roll No. · Name · Email · Specialization (chosen) · Section (assigned) · Seat

**Filtering:**
- Search by name, roll number, or email.
- Filter by specialization using quick-filter buttons.

---

### 4.7 Student List Management

Location: **Sidebar → Student list**

The master list of who is allowed to log in as a student. This list is **not hard-coded** — the admin uploads it for each batch.

#### Upload (Excel / PDF / CSV)

| File type | Notes |
|-----------|-------|
| `.xlsx` / `.xls` | Standard Excel — recommended |
| `.csv` | Comma-separated values |
| `.pdf` | Text-based PDFs only (not scanned images) |
| `.ods` | OpenDocument Spreadsheet |

**Column auto-detection:** The system detects columns by content, not position:
- Email found by `@` symbol
- Roll number found by pattern (e.g. `22CSU001`)
- Name takes whatever is left

**Upload modes:**

| Mode | Behaviour |
|------|-----------|
| **Add from file** | Merges new records with existing list; skips duplicate emails |
| **Replace all from file** | Clears the entire existing list and replaces it with the uploaded data |

**Preview before commit:** After selecting a file, a preview table shows the extracted records before they are saved. The admin can cancel or confirm.

**Download Excel template:** A pre-formatted `.xlsx` file with the correct column headers for easy data entry.

#### Manual management

| Action | Notes |
|--------|-------|
| **Add student** | Add a single student with name, roll number, email |
| **Edit student** | Update any field for an existing student |
| **Remove student** | Delete a student from the authorized list |

**Email domain:** All student emails must end with `@ncuindia.edu`. This is enforced at login.

---

### 4.8 Admin Access Management

Location: **Sidebar → Admin access**

Controls who can log in as an admin.

| Action | Notes |
|--------|-------|
| **Add admin** | Add a new email to the authorized admin list with a name and role |
| **Remove admin** | Remove an admin (cannot remove yourself) |

**Roles:**

| Role | Meaning |
|------|---------|
| **Primary** | The main mentor/admin |
| **Team** | Project team members with full admin access |

**Constraints:**
- Admin and student email lists must not overlap.
- Attempting to add a student's email as an admin is blocked with an error.
- You cannot remove your own access.
- No public registration — only listed emails can access the panel.

---

## 5. Student Features

### 5.1 Dashboard

- Welcome message with student name and roll number.
- **3-step progress tracker** showing:
  1. Choose specialization
  2. Wait for admin to finalize sections
  3. Pick section & seat
- The active step is highlighted; completed steps show a green checkmark.
- Summary cards showing current specialization and assigned section/seat.
- System phase banner showing the current state of the portal.

---

### 5.2 Specialization Selection

Location: **Sidebar → Pick specialization**

When the specialization window is **open:**
- All **active** specializations are displayed as large selectable cards.
- Each card shows the specialization name, batch year, and description.
- Clicking a card immediately selects it.
- A previously selected specialization can be changed by clicking a different card while the window is still open.

When the window is **closed:**
- All cards are greyed out with a lock notice.
- The student's current selection is still visible.

---

### 5.3 Section & Seat Selection

Location: **Sidebar → Pick section & seat**

Available when the section-selection window is **open** and the student has chosen a specialization.

**Step 1 — Choose section:**
- Only sections under the student's chosen specialization are shown.
- Each section card shows name, current occupancy, and percentage full.
- Clicking a section card shows its seat map.

**Step 2 — Choose seat (theatre-style map):**

| Seat state | Visual |
|------------|--------|
| Available | Light grey |
| Your current seat | Yellow (`#d8ff5b`) |
| Taken by someone else | Dark / black |

- Seats are laid out in rows (A, B, C…) with 10 columns each.
- Hovering over a seat shows a tooltip describing its state.
- Clicking an available seat confirms the selection immediately.
- A student can change their seat by clicking a different available seat.
- Seats cannot be double-booked.

**Section roster:**
- Alongside the seat map, a live list shows all students currently seated in that section, sorted by seat number.
- The current student's own row is highlighted.

**Pre-conditions:**
- Student must have selected a specialization.
- Admin must have finalized sections.
- Section-selection window must be open.

---

## 6. UI Layout

### Fixed Sidebar

The sidebar is **always visible and never scrolls** as part of the page. It contains:

- Brand logo and portal name
- Current system phase indicator
- Navigation links (role-appropriate)
- Logout button at the bottom (always visible — no need to scroll)

### Scrollable Main Content

Only the main content area scrolls. The sidebar and top header remain fixed regardless of how much content is on the page.

```
┌─────────────────────────────────────────────────┐
│  HEADER (fixed, 56px tall)                      │
├───────────────┬─────────────────────────────────┤
│               │                                 │
│   SIDEBAR     │   MAIN CONTENT                  │
│   (fixed,     │   (scrolls independently)       │
│   never       │                                 │
│   scrolls)    │   Dashboard / Specializations / │
│               │   Sections / Seats / etc.       │
│               │                                 │
│   [Logout]    │                                 │
│   always      │                                 │
│   visible     │                                 │
└───────────────┴─────────────────────────────────┘
```

This layout is consistent across both the **admin dashboard** and **student dashboard**.

On mobile, the sidebar collapses into a slide-in drawer triggered by a hamburger menu in the header.

---

## 7. Data Model

### AppState

```typescript
interface AppState {
  phase: AppPhase;                   // Current system phase
  specWindowStatus: "OPEN" | "CLOSED";
  sectionWindowStatus: "OPEN" | "CLOSED";
  sectionWindowDeadline: string | null;
  specializations: SpecializationDef[];  // Dynamic — not hard-coded
  students: Student[];
  sections: Section[];
  adminUsers: AdminUser[];
}
```

### SpecializationDef

```typescript
interface SpecializationDef {
  id: string;
  name: string;          // e.g. "Data Science"
  batch: string;         // e.g. "2024-25"
  active: boolean;       // Only active specs shown to students
  description?: string;
  createdAt: string;
}
```

### Student

```typescript
interface Student {
  id: string;
  rollNumber: string;              // e.g. "22CSU001"
  name: string;
  email: string;                   // Must be @ncuindia.edu
  chosenSpecialization: string | null;
  assignedSectionId: string | null;
  assignedSeat: number | null;     // 1-based seat number
}
```

### Section

```typescript
interface Section {
  id: string;
  specializationName: string;  // Links to SpecializationDef.name
  name: string;                // "Section A", "Section B", …
  capacity: number;            // Admin-adjustable
}
```

### AdminUser

```typescript
interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "primary" | "team";
  addedAt: string;
}
```

### AppPhase (state machine)

```
SPEC_WINDOW_OPEN
      ↓  (admin closes window)
SPEC_WINDOW_CLOSED      ← sections auto-generated here
      ↓  (admin finalizes)
SECTIONS_FINALIZED
      ↓  (admin opens window)
SECTION_WINDOW_OPEN
      ↓  (admin closes window)
SECTION_WINDOW_CLOSED
```

---

## 8. File Upload Formats

### Excel / CSV — Recommended column order

| Column | Required | Notes |
|--------|----------|-------|
| Name | Yes | Student's full name |
| Roll Number | Yes | e.g. `22CSU001` |
| Email | Yes | Must end with `@ncuindia.edu` |
| Section | No | Ignored during upload (sections are generated by the system) |

**Column order is auto-detected** — the system identifies email by `@`, roll number by regex pattern, and name by elimination. Columns do not need to be in any specific order.

**Header row** is optional. If the first row contains "name", "roll", or "s.no", it is skipped automatically.

### PDF

- Must be a **text-based PDF** (not a scanned image).
- The system extracts all email addresses matching `*@*.*` and roll numbers matching the `\d{2}[A-Z]{2,4}\d{3}` pattern.
- If no emails are found, an error is shown asking to use a text-based PDF.

---

## 9. System Phases

| Phase | Student can | Admin can |
|-------|-------------|-----------|
| `SPEC_WINDOW_OPEN` | Select specialization | View counts, manage specs, close window |
| `SPEC_WINDOW_CLOSED` | View their selection (locked) | Adjust section capacities, finalize |
| `SECTIONS_FINALIZED` | View their selection (locked) | Open section-selection window |
| `SECTION_WINDOW_OPEN` | Choose section and seat | View live occupancy, close window |
| `SECTION_WINDOW_CLOSED` | View their assigned section/seat | Full read access to all data |

---

## 10. Key Rules & Constraints

### Authentication
- No self-registration for either students or admins.
- Student emails must end with `@ncuindia.edu`.
- Admin emails can be any domain (e.g. `@gmail.com` is allowed for team members).
- Admin and student email lists must not overlap.
- OTP is 6 digits, valid for 10 minutes, single-use.

### Specializations
- Not hard-coded — fully managed via the admin panel.
- Only **active** specializations appear in the student portal.
- A specialization cannot be deleted if any student has already selected it.
- Multiple specializations can be active at the same time.

### Sections
- Auto-generated at the moment the specialization window is closed.
- Target: **50 students per section**.
- Seats are distributed as evenly as possible across sections.
- Admin can manually adjust capacities before finalizing.
- A warning is shown if total section capacity differs from the number of students who selected that specialization.

### Seat selection
- Students choose their own seats — the system does not auto-assign.
- Seats are shown in a theatre-style grid (rows A, B, C… × 10 columns).
- A seat can only be held by one student at a time.
- Students can see who else is in their chosen section before committing.
- Students can change their seat at any time while the section-selection window is open.

### Student list
- Not hard-coded — uploaded via Excel/PDF/CSV by the admin.
- Upload a new file to use the system for a different batch without code changes.
- "Add from file" merges; "Replace all from file" starts fresh.
- A preview of extracted records is shown before any changes are committed.

---

*Last updated: SectionSync v1.0 — NCU 4th Year CSE Portal*
