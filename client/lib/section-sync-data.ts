// ─────────────────────────────────────────────────────────────────
// Specialization — fully dynamic, not hard-coded
// ─────────────────────────────────────────────────────────────────

export interface SpecializationDef {
  id: string;
  name: string;
  /** Academic year / batch this spec applies to, e.g. "2024-25" */
  batch: string;
  /** When false the spec is hidden from the student selection screen */
  active: boolean;
  /** Optional description shown to students */
  description?: string;
  createdAt: string;
}

/** Convenience: returns only active specialization names */
export function activeSpecNames(specs: SpecializationDef[]): string[] {
  return specs.filter((s) => s.active).map((s) => s.name);
}

// ─────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────

export type Role = "admin" | "student";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "primary" | "team";
  addedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// Student
// ─────────────────────────────────────────────────────────────────

export interface Student {
  id: string;
  rollNumber: string;
  name: string;
  /** Must be @ncuindia.edu for students */
  email: string;
  /** The specialization name chosen during spec-selection window */
  chosenSpecialization: string | null;
  assignedSectionId: string | null;
  assignedSeat: number | null;
  /** Assigned when section window closes: 1 = G1, 2 = G2 */
  group: 1 | 2 | null;
}

// ─────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────

export interface Section {
  id: string;
  specializationName: string;
  name: string;
  capacity: number; // starts at 0 — admin sets manually
}

// ─────────────────────────────────────────────────────────────────
// App phase
// ─────────────────────────────────────────────────────────────────

export type AppPhase =
  | "SPEC_WINDOW_OPEN"
  | "SPEC_WINDOW_CLOSED"
  | "SECTIONS_FINALIZED"
  | "SECTION_WINDOW_OPEN"
  | "SECTION_WINDOW_CLOSED";

export type SpecWindowStatus = "CLOSED" | "OPEN";
export type SectionWindowStatus = "CLOSED" | "OPEN";

// ─────────────────────────────────────────────────────────────────
// Swap request
// ─────────────────────────────────────────────────────────────────

export type SwapStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";

export interface SwapRequest {
  id: string;
  requesterId: string;  // student who sent it
  targetId: string;     // student they want to swap with
  requesterSectionId: string | null;
  targetSectionId: string | null;
  status: SwapStatus;
  note?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ─────────────────────────────────────────────────────────────────
// App state
// ─────────────────────────────────────────────────────────────────

export interface AppState {
  phase: AppPhase;
  specWindowStatus: SpecWindowStatus;
  sectionWindowStatus: SectionWindowStatus;
  sectionWindowDeadline: string | null;
  specializations: SpecializationDef[];
  students: Student[];
  sections: Section[];
  adminUsers: AdminUser[];
  swapRequests: SwapRequest[];
}

// ─────────────────────────────────────────────────────────────────
// Seat helpers
// ─────────────────────────────────────────────────────────────────

export function takenSeats(section: Section, students: Student[]): number[] {
  return students
    .filter((s) => s.assignedSectionId === section.id && s.assignedSeat !== null)
    .map((s) => s.assignedSeat as number);
}

// ─────────────────────────────────────────────────────────────────
// Auto-section creation
// ─────────────────────────────────────────────────────────────────

const SECTION_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const TARGET_CAPACITY = 50;

function specAbbrev(name: string): string {
  const map: Record<string, string> = {
    "artificial intelligence and machine learning": "AIML",
    "ai/ml": "AIML",
    "aiml": "AIML",
    "data science": "DS",
    "cyber security": "CS",
    "cybersecurity": "CS",
    "full stack": "FS",
    "cloud computing": "CC",
  };
  const lower = name.toLowerCase().trim();
  for (const [key, abbr] of Object.entries(map)) {
    if (lower.includes(key)) return abbr;
  }
  return name.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4);
}

export function computeSectionCapacities(count: number): number[] {
  if (count === 0) return [];
  const numSections = Math.ceil(count / TARGET_CAPACITY);
  const base = Math.floor(count / numSections);
  const remainder = count % numSections;
  return Array.from({ length: numSections }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}

export function autoCreateSections(
  students: Student[],
  specializations: SpecializationDef[],
): Section[] {
  const sections: Section[] = [];
  for (const spec of specializations.filter((s) => s.active)) {
    const count = students.filter((s) => s.chosenSpecialization === spec.name).length;
    const capacities = computeSectionCapacities(count);
    capacities.forEach((_, i) => {
      sections.push({
        id: `${spec.id}-sec-${i}`,
        specializationName: spec.name,
        name: `${specAbbrev(spec.name)}-${SECTION_NAMES[i] ?? i + 1}`,
        capacity: 0, // admin sets capacity manually
      });
    });
  }
  return sections;
}

// ─────────────────────────────────────────────────────────────────
// Seed data
// ─────────────────────────────────────────────────────────────────

export function createDefaultSpecializations(): SpecializationDef[] {
  const now = new Date().toISOString();
  return [
    { id: "spec-ds",  name: "Data Science",    batch: "2024-25", active: true,  description: "Statistics, ML foundations, data pipelines, and analytics.", createdAt: now },
    { id: "spec-ai",  name: "AI/ML",            batch: "2024-25", active: true,  description: "Deep learning, NLP, computer vision, and research.", createdAt: now },
    { id: "spec-fs",  name: "Full Stack",       batch: "2024-25", active: true,  description: "Web development, APIs, databases, and modern frameworks.", createdAt: now },
    { id: "spec-cy",  name: "Cybersecurity",    batch: "2024-25", active: true,  description: "Network security, ethical hacking, and cryptography.", createdAt: now },
    { id: "spec-cc",  name: "Cloud Computing",  batch: "2024-25", active: true,  description: "AWS/Azure/GCP, DevOps, and distributed systems.", createdAt: now },
  ];
}

const _firstNames = [
  "Kumkum","Aarav","Aditi","Advait","Ananya","Arjun","Avni","Dhruv","Diya",
  "Ishaan","Ira","Kabir","Kiara","Lakshya","Mahi","Manan","Meera","Naman",
  "Navya","Neel","Nisha","Parth","Prisha","Rahul","Rhea","Ritvik","Saanvi",
  "Sameer","Sara","Shaurya","Siya","Tanishq","Tara","Uday","Vanya","Vedant",
  "Vidhi","Vihaan","Yashvi","Zoya","Ayaan","Anvi","Devansh","Ishita","Kartik",
  "Myra","Raghav","Suhana","Vivaan","Tanvi","Rohan","Pihu","Aditya","Sakshi",
  "Varun","Kavya","Harsh","Riya","Mohit","Ishika","Siddharth","Ayesha","Rudra",
  "Manya","Karan","Simran","Veer","Nandini","Abhinav","Shreya","Yuvraj","Moksh",
  "Arnav","Bhavya","Chirag","Deepika","Eshan","Fiza","Gaurav","Harshita",
  "Ishan","Jiya","Krish","Lavanya","Mihir","Neha","Ojas","Pallavi",
  "Ridhi","Sparsh","Tanya","Utkarsh","Vrinda","Yash","Zara",
];
const _lastNames = [
  "Singh","Mehta","Sharma","Kapoor","Gupta","Bhatia","Nair","Khanna","Anand",
  "Bansal","Jain","Arora","Joshi","Goyal","Rao","Agarwal","Suri","Sood",
  "Dhingra","Menon","Dutta","Bose","Iyer","Oberoi","Das","Chawla","Roy",
  "Ahuja","Yadav","Mittal","Shah","Puri","Sen","Goel","Rathi",
  "Bedi","Vohra","Saini","Sinha","Gill","Malhotra","Verma","Mishra","Reddy",
  "Patel","Khan","Seth","Chopra","Tiwari",
];

export function createStudents(): Student[] {
  return Array.from({ length: 120 }, (_, i) => {
    const n = i + 1;
    const roll = `22CSU${String(n).padStart(3, "0")}`;
    const name = i === 0
      ? "Kumkum Singh"
      : `${_firstNames[n % _firstNames.length]} ${_lastNames[Math.floor(n / _firstNames.length) % _lastNames.length]}`;
    return {
      id: `student-${n}`,
      rollNumber: roll,
      name,
      email: `${roll.toLowerCase()}@ncuindia.edu`,
      chosenSpecialization: null,
      assignedSectionId: null,
      assignedSeat: null,
      group: null,
    };
  });
}

/** Hardcoded authorized admins — only these two emails can log in as admin */
export function createAdminUsers(): AdminUser[] {
  const now = new Date().toISOString();
  return [
    { id: "admin-1", name: "Manvi Breja",   email: "manvibreja@ncuindia.edu", role: "primary", addedAt: now },
    { id: "admin-2", name: "Kumkum Singh",  email: "kumkum33517@gmail.com",   role: "team",    addedAt: now },
  ];
}

export function createInitialData(): AppState {
  return {
    phase: "SPEC_WINDOW_OPEN",
    specWindowStatus: "OPEN",
    sectionWindowStatus: "CLOSED",
    sectionWindowDeadline: null,
    specializations: createDefaultSpecializations(),
    students: createStudents(),
    sections: [],
    adminUsers: createAdminUsers(),
    swapRequests: [],
  };
}
