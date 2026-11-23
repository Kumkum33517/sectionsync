import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Menu,
  Pencil,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Table2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Upload,
  UserCog,
  Users,
  Waypoints,
  X,
} from "lucide-react";
import {
  activeSpecNames,
  autoCreateSections,
  computeSectionCapacities,
  createInitialData,
  takenSeats,
  type AdminUser,
  type AppPhase,
  type AppState,
  type Section,
  type SpecializationDef,
  type Student,
  type SwapRequest,
  type SwapStatus,
} from "@/lib/section-sync-data";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────
type Session = { role: "admin" | "student"; studentId?: string; email: string; accessToken?: string } | null;
type Toast = { message: string; error?: boolean } | null;
type AdminPage =
  | "dashboard"
  | "specializations"
  | "spec-window"
  | "sections"
  | "section-window"
  | "students"
  | "student-list"
  | "admin-access"
  | "change-password";
type StudentPage = "dashboard" | "spec-selection" | "section-seat" | "swaps" | "change-password";

// ─────────────────────────────────────────────────────────────────
// Password-based sign-in
// ─────────────────────────────────────────────────────────────────

async function signIn(email: string, password: string): Promise<{
  ok: boolean; error?: string; role?: string;
  access_token?: string; refresh_token?: string; expires_at?: number;
}> {
  try {
    // Step 1: call server-side API — checks admins table with service role key
    // so role detection is always correct regardless of RLS
    const res = await fetch("/api/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error ?? "Incorrect email or password." };

    // Step 2: set the Supabase session using the tokens from our API
    // This makes the anon client usable for RLS-protected operations (specs, etc.)
    // AND persists the session in localStorage so refresh doesn't log you out
    if (data.access_token && data.refresh_token) {
      await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
    }

    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "Network error. Check your connection." };
  }
}

async function changePassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: "Failed to update password. Please try again." };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<AppPhase, string> = {
  SPEC_WINDOW_OPEN: "Specialization selection open",
  SPEC_WINDOW_CLOSED: "Spec window closed — sections pending",
  SECTIONS_FINALIZED: "Sections finalized — awaiting section window",
  SECTION_WINDOW_OPEN: "Section & seat selection open",
  SECTION_WINDOW_CLOSED: "Section selection closed",
};

// Spec colour palette (cycles for any number of specs)
const SPEC_PALETTE = [
  { dot: "bg-violet-500", badge: "bg-violet-100 border-violet-300 text-violet-800", bar: "bg-violet-500" },
  { dot: "bg-blue-500",   badge: "bg-blue-100 border-blue-300 text-blue-800",       bar: "bg-blue-500"   },
  { dot: "bg-emerald-500",badge: "bg-emerald-100 border-emerald-300 text-emerald-800",bar:"bg-emerald-500"},
  { dot: "bg-red-500",    badge: "bg-red-100 border-red-300 text-red-800",           bar: "bg-red-500"    },
  { dot: "bg-sky-500",    badge: "bg-sky-100 border-sky-300 text-sky-800",           bar: "bg-sky-500"    },
  { dot: "bg-amber-500",  badge: "bg-amber-100 border-amber-300 text-amber-800",     bar: "bg-amber-500"  },
  { dot: "bg-pink-500",   badge: "bg-pink-100 border-pink-300 text-pink-800",        bar: "bg-pink-500"   },
  { dot: "bg-teal-500",   badge: "bg-teal-100 border-teal-300 text-teal-800",        bar: "bg-teal-500"   },
];
function specPalette(idx: number) { return SPEC_PALETTE[idx % SPEC_PALETTE.length]; }

// ─────────────────────────────────────────────────────────────────
// UI primitives
// ─────────────────────────────────────────────────────────────────
function Badge({ children, color = "default" }: {
  children: React.ReactNode;
  color?: "default" | "green" | "yellow" | "red" | "blue" | "lime";
}) {
  const map = {
    default: "bg-[#e8ead8] text-[#0b1825]",
    green:   "bg-emerald-100 text-emerald-800",
    yellow:  "bg-amber-100 text-amber-800",
    red:     "bg-red-100 text-red-700",
    blue:    "bg-blue-100 text-blue-700",
    lime:    "bg-[#d8ff5b]/40 text-[#3a5c00]",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[color]}`}>{children}</span>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border border-[#dde4cc] ${className}`}>{children}</div>;
}

function Btn({ children, onClick, disabled, variant = "primary", className = "", type = "button" }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "lime";
  className?: string;
  type?: "button" | "submit";
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-40 disabled:cursor-not-allowed";
  const v = {
    primary:   "bg-[#0b1825] text-white hover:bg-[#1a2e3f]",
    secondary: "border border-[#dde4cc] text-[#0b1825] hover:bg-[#f5f6ef]",
    danger:    "bg-red-600 text-white hover:bg-red-700",
    lime:      "bg-[#d8ff5b] text-[#0b1825] hover:bg-[#c8ef4b]",
  };
  return <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${v[variant]} ${className}`}>{children}</button>;
}

function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-[#0b1825] mb-1.5">{label}</label>}
      <input {...props} className={`w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-4 py-2.5 text-sm outline-none focus:border-[#0b1825] focus:ring-2 focus:ring-[#0b1825]/10 transition ${props.className ?? ""}`} />
    </div>
  );
}

function PhaseBanner({ phase }: { phase: AppPhase }) {
  const icons: Record<AppPhase, React.ReactNode> = {
    SPEC_WINDOW_OPEN:    <Clock size={14} />,
    SPEC_WINDOW_CLOSED:  <Lock size={14} />,
    SECTIONS_FINALIZED:  <CheckCircle2 size={14} />,
    SECTION_WINDOW_OPEN: <Clock size={14} />,
    SECTION_WINDOW_CLOSED: <CheckCircle2 size={14} />,
  };
  const colors: Record<AppPhase, string> = {
    SPEC_WINDOW_OPEN:    "bg-[#d8ff5b]/30 text-[#3a5c00] border-[#d8ff5b]",
    SPEC_WINDOW_CLOSED:  "bg-amber-50 text-amber-800 border-amber-200",
    SECTIONS_FINALIZED:  "bg-blue-50 text-blue-800 border-blue-200",
    SECTION_WINDOW_OPEN: "bg-[#d8ff5b]/30 text-[#3a5c00] border-[#d8ff5b]",
    SECTION_WINDOW_CLOSED:"bg-emerald-50 text-emerald-800 border-emerald-200",
  };
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${colors[phase]}`}>
      {icons[phase]}{PHASE_LABELS[phase]}
    </div>
  );
}

const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

// ─────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────
function LoginScreen({ state, onLogin }: { state: AppState; onLogin: (s: NonNullable<Session>) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const em = email.trim().toLowerCase();
    if (!em || !password) { setError("Enter your email and password."); return; }

    setLoading(true);
    const result = await signIn(em, password);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? "Incorrect email or password.");
      return;
    }

    // Find student record for studentId
    const student = state.students.find((s) => s.email.toLowerCase() === em);
    onLogin({
      role:        result.role as "admin" | "student",
      email:       em,
      studentId:   result.role === "student" ? student?.id : undefined,
      accessToken: result.access_token,
    });
  };

  return (
    <div className="min-h-screen bg-[#f5f6ef] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-[#0b1825] flex items-center justify-center">
            <Waypoints size={18} className="text-[#d8ff5b]" />
          </div>
          <div>
            <p className="font-display font-bold text-[#0b1825] text-lg leading-none">SectionSync</p>
            <p className="text-xs text-[#71818a] mt-0.5">NCU · 2nd Year Portal</p>
          </div>
        </div>

        <Card className="p-8">
          <h1 className="font-display text-2xl font-bold text-[#0b1825] mb-1">Sign in</h1>
          <p className="text-sm text-[#71818a] mb-6">Use your NCU email and password.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder=""
              autoFocus
            />
            <div>
              <label className="block text-sm font-medium text-[#0b1825] mb-1.5">Password</label>
              <div className="relative">
                <input
                  id="password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-4 py-2.5 pr-10 text-sm outline-none focus:border-[#0b1825] focus:ring-2 focus:ring-[#0b1825]/10 transition"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById("password-input") as HTMLInputElement;
                    el.type = el.type === "password" ? "text" : "password";
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71818a] hover:text-[#0b1825] transition text-xs"
                >
                  Show
                </button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600 flex items-center gap-1.5">
                <AlertTriangle size={13} />{error}
              </p>
            )}
            <Btn type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Btn>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-[#71818a]">
          No self-registration. Only authorized users can sign in.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// App shell — fixed sidebar + scrollable main
// ─────────────────────────────────────────────────────────────────
function AppShell({ session, state, adminPage, studentPage, setAdminPage, setStudentPage, onLogout, children }: {
  session: NonNullable<Session>;
  state: AppState;
  adminPage: AdminPage;
  studentPage: StudentPage;
  setAdminPage: (p: AdminPage) => void;
  setStudentPage: (p: StudentPage) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = session.role === "admin";
  const liveMe = session.studentId ? state.students.find((s) => s.id === session.studentId) : null;

  const adminNav: { id: AdminPage; label: string; icon: React.ElementType; dividerBefore?: boolean }[] = [
    { id: "dashboard",       label: "Dashboard",           icon: LayoutDashboard },
    { id: "specializations", label: "Specializations",     icon: BookOpen },
    { id: "spec-window",     label: "Spec window",         icon: CalendarDays },
    { id: "sections",        label: "Sections",            icon: Table2 },
    { id: "section-window",  label: "Section window",      icon: Settings },
    { id: "students",        label: "All students",        icon: Users,    dividerBefore: true },
    { id: "student-list",    label: "Student list",        icon: UserCog },
    { id: "admin-access",    label: "Admin access",        icon: Shield },
    { id: "change-password", label: "Change password",     icon: KeyRound, dividerBefore: true },
  ];

  const studentNav: { id: StudentPage; label: string; icon: React.ElementType }[] = [
    { id: "dashboard",       label: "Dashboard",            icon: LayoutDashboard },
    { id: "spec-selection",  label: "Pick specialization",  icon: Sparkles },
    { id: "section-seat",    label: "Pick section & seat",  icon: GraduationCap },
    { id: "swaps",           label: "Swap requests",        icon: ArrowLeftRight },
    { id: "change-password", label: "Change password",      icon: KeyRound },
  ];

  const pageTitle = isAdmin
    ? adminNav.find((n) => n.id === adminPage)?.label ?? ""
    : studentNav.find((n) => n.id === studentPage)?.label ?? "";

  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#1e3044] shrink-0">
        <div className="h-8 w-8 rounded-lg bg-[#d8ff5b] flex items-center justify-center shrink-0">
          <Waypoints size={14} className="text-[#0b1825]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-white text-sm leading-none">SectionSync</p>
          <p className="text-[10px] text-[#71818a] mt-0.5">NCU 2nd Year</p>
        </div>
        <button className="lg:hidden text-[#71818a] hover:text-white" onClick={() => setMobileOpen(false)}>
          <X size={16} />
        </button>
      </div>

      {/* Phase indicator */}
      <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-[#142030] text-[10px] text-[#71818a] leading-relaxed shrink-0">
        <span className="block text-[#d8ff5b] font-semibold mb-0.5">System phase</span>
        {PHASE_LABELS[state.phase]}
      </div>

      {/* Nav — scrollable if many items */}
      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto min-h-0">
        {(isAdmin ? adminNav : studentNav).map((item) => {
          const active = isAdmin ? adminPage === item.id : studentPage === item.id;
          return (
            <div key={item.id}>
              {"dividerBefore" in item && item.dividerBefore && (
                <div className="mx-2 my-2 border-t border-[#1e3044]" />
              )}
              <button
                onClick={() => {
                  if (isAdmin) setAdminPage(item.id as AdminPage);
                  else setStudentPage(item.id as StudentPage);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition
                  ${active ? "bg-[#1e3044] text-white" : "text-[#c8d4d8] hover:bg-[#142030] hover:text-white"}`}
              >
                <item.icon size={15} />{item.label}
              </button>
            </div>
          );
        })}
      </nav>

      {/* User footer — always at bottom */}
      <div className="px-4 pb-5 pt-3 border-t border-[#1e3044] shrink-0">
        <div className="flex items-center gap-3">
          {/* Avatar: coloured circle with first letter of first name */}
          <div className="h-8 w-8 rounded-full bg-[#d8ff5b] flex items-center justify-center text-[#0b1825] text-xs font-bold shrink-0">
            {isAdmin
              ? (state.adminUsers.find((a) => a.email.toLowerCase() === session.email.toLowerCase())?.name?.[0] ?? "A").toUpperCase()
              : (liveMe?.name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {/* Show full name, never just a number */}
            <p className="text-xs font-semibold text-white truncate">
              {isAdmin
                ? (state.adminUsers.find((a) => a.email.toLowerCase() === session.email.toLowerCase())?.name ?? "Admin")
                : (liveMe?.name ?? session.email)}
            </p>
            <p className="text-[10px] text-[#71818a] truncate">{session.email}</p>
          </div>
          <button onClick={onLogout} className="text-[#71818a] hover:text-red-400 transition" title="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    // Full viewport height, no page scroll — only inner main scrolls
    <div className="h-screen flex overflow-hidden bg-[#f5f6ef] text-[#0b1825]">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar — full height column, nav scrolls independently, footer always pinned */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-60 bg-[#0b1825] flex flex-col h-screen
        transition-transform duration-200
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:relative lg:inset-y-auto lg:translate-x-0 lg:shrink-0
      `}>
        <SidebarContent />
      </aside>

      {/* Right side: header + scrollable main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header — fixed, never scrolls */}
        <header className="h-14 bg-white border-b border-[#dde4cc] flex items-center gap-3 px-4 shrink-0">
          <button className="lg:hidden text-[#71818a] hover:text-[#0b1825]" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="font-display font-bold text-[#0b1825] text-base">{pageTitle}</h1>
          {isAdmin && (
            <div className="ml-auto">
              <Badge color={state.phase === "SPEC_WINDOW_OPEN" || state.phase === "SECTION_WINDOW_OPEN" ? "lime" : "default"}>
                {state.phase.replace(/_/g, " ")}
              </Badge>
            </div>
          )}
        </header>

        {/* Main content — this is the ONLY thing that scrolls */}
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Dashboard
// ─────────────────────────────────────────────────────────────────
function AdminDashboard({ state }: { state: AppState }) {
  const total    = state.students.length;
  const selected = state.students.filter((s) => s.chosenSpecialization !== null).length;
  const assigned = state.students.filter((s) => s.assignedSectionId !== null).length;
  const activeSpecs = state.specializations.filter((s) => s.active);
  const specCounts = activeSpecs.map((spec, i) => ({
    spec, i,
    count: state.students.filter((s) => s.chosenSpecialization === spec.name).length,
  }));

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#0b1825]">Admin Dashboard</h2>
        <p className="text-sm text-[#71818a] mt-1">Specialization &amp; section management</p>
      </div>
      <PhaseBanner phase={state.phase} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Authorized students", value: total,                       icon: Users,         sub: `${total - selected} yet to select` },
          { label: "Spec selected",        value: selected,                   icon: Sparkles,      sub: `${total - selected} pending` },
          { label: "Sections created",     value: state.sections.length,      icon: Table2,        sub: "across all specs" },
          { label: "Seats taken",          value: assigned,                   icon: CheckCircle2,  sub: `of ${total}` },
        ].map(({ label, value, icon: Icon, sub }) => (
          <Card key={label} className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#71818a] font-medium">{label}</span>
              <div className="h-8 w-8 rounded-xl bg-[#f0f2e4] flex items-center justify-center text-[#0b1825]">
                <Icon size={15} />
              </div>
            </div>
            <div className="text-3xl font-bold font-display text-[#0b1825]">{value}</div>
            <p className="text-xs text-[#71818a]">{sub}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-[#eef0e4] flex items-center justify-between">
          <h3 className="font-semibold text-[#0b1825]">Specialization selection</h3>
          <span className="text-xs text-[#71818a]">{selected} / {total} responded</span>
        </div>
        <div className="divide-y divide-[#f5f6ef]">
          {specCounts.map(({ spec, i, count }) => {
            const pct  = total > 0 ? Math.round((count / total) * 100) : 0;
            const caps = computeSectionCapacities(count);
            const pal  = specPalette(i);
            return (
              <div key={spec.id} className="px-5 py-4 flex items-center gap-4">
                <div className={`h-2 w-2 rounded-full shrink-0 ${pal.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-[#0b1825]">{spec.name}</span>
                    <span className="text-sm font-bold text-[#0b1825]">{count} students</span>
                  </div>
                  <div className="h-1.5 bg-[#f0f2e4] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pal.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0 text-xs text-[#71818a] w-32">
                  {caps.length > 0 ? `→ ${caps.length} section${caps.length > 1 ? "s" : ""} (${caps.join(", ")} seats)` : "no selections yet"}
                </div>
              </div>
            );
          })}
          {activeSpecs.length === 0 && (
            <div className="px-5 py-6 text-sm text-center text-[#71818a]">No active specializations. Add some in the Specializations page.</div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Specialization management (dynamic CRUD)
// ─────────────────────────────────────────────────────────────────
function AdminSpecializations({ state, showToast, setState, token }: {
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  token: string;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", batch: "2024-25", description: "", active: true });
  const [formErr, setFormErr] = useState("");

  const openAdd = () => {
    setForm({ name: "", batch: "2024-25", description: "", active: true });
    setFormErr(""); setEditId(null); setShowForm(true);
  };
  const openEdit = (spec: SpecializationDef) => {
    setForm({ name: spec.name, batch: spec.batch, description: spec.description ?? "", active: spec.active });
    setFormErr(""); setEditId(spec.id); setShowForm(true);
  };

  const save = async () => {
    setFormErr("");
    if (!form.name.trim()) { setFormErr("Specialization name is required."); return; }
    if (!form.batch.trim()) { setFormErr("Batch / academic year is required."); return; }
    const dup = state.specializations.find(
      (s) => s.name.toLowerCase() === form.name.trim().toLowerCase() && s.id !== editId
    );
    if (dup) { setFormErr("A specialization with this name already exists."); return; }


    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (editId) {
      try {
        const res = await fetch("/api/admin-specializations", {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: editId, name: form.name.trim(), batch: form.batch.trim(), description: form.description.trim() || null, active: form.active }),
        });
        if (!res.ok) { setFormErr("Failed to update. Try again."); return; }
      } catch { setFormErr("Network error. Try again."); return; }
      setState((p) => ({
        ...p,
        specializations: p.specializations.map((s) =>
          s.id === editId ? { ...s, name: form.name.trim(), batch: form.batch.trim(), description: form.description.trim() || undefined, active: form.active } : s
        ),
      }));
      showToast("Specialization updated.");
    } else {
      try {
        const res = await fetch("/api/admin-specializations", { method: "POST", headers, body: JSON.stringify({ name: form.name.trim(), batch: form.batch.trim(), description: form.description.trim() || null, active: form.active }) });
        const data = await res.json();
        if (!res.ok) { setFormErr(data.error ?? "Failed to save. Try again."); return; }
        // Re-fetch the new spec row to get the generated id
        const listRes = await fetch("/api/admin-specializations", { headers: { Authorization: `Bearer ${token}` } });
        const listData = await listRes.json();
        if (listData.data) setState((p) => ({ ...p, specializations: listData.data.map((s: any) => ({ id: s.id, name: s.name, batch: s.batch, active: s.active, description: s.description ?? undefined, createdAt: s.created_at })) }));
        showToast(`"${form.name.trim()}" added.`);
      } catch { setFormErr("Network error. Try again."); return; }
    }
    setShowForm(false);
  };

  const remove = async (id: string, name: string) => {
    const inUse = state.students.some((s) => s.chosenSpecialization === name);
    if (inUse) { showToast(`Cannot remove "${name}" — students have already selected it.`, true); return; }
    try {
      const res = await fetch(`/api/admin-specializations?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { showToast("Failed to delete. Try again.", true); return; }
    } catch { showToast("Network error. Try again.", true); return; }
    setState((p) => ({ ...p, specializations: p.specializations.filter((s) => s.id !== id) }));
    showToast(`"${name}" removed.`);
  };

  const toggle = async (id: string) => {
    const spec = state.specializations.find((s) => s.id === id);
    if (!spec) return;
    try {
      const res = await fetch("/api/admin-specializations", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, active: !spec.active }),
      });
      if (!res.ok) { showToast("Failed to update. Try again.", true); return; }
    } catch { showToast("Network error. Try again.", true); return; }
    setState((p) => ({
      ...p,
      specializations: p.specializations.map((s) => s.id === id ? { ...s, active: !s.active } : s),
    }));
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0b1825]">Specializations</h2>
          <p className="text-sm text-[#71818a] mt-0.5">
            Add, edit, or toggle specializations. Only <strong>active</strong> ones appear in the student portal.
          </p>
        </div>
        <Btn onClick={openAdd}><Plus size={14} /> Add specialization</Btn>
      </div>

      

      {/* Form */}
      {showForm && (
        <Card className="p-5">
          <h3 className="font-semibold text-[#0b1825] mb-4">{editId ? "Edit specialization" : "Add specialization"}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Specialization name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Data Science" />
            <Input label="Academic year / batch" value={form.batch}
              onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))}
              placeholder="e.g. 2024-25" />
          </div>
          <div className="mt-4">
            <Input label="Description (optional)" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Short description shown to students" />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
              className={`flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-sm font-medium transition
                ${form.active ? "border-[#0b1825] bg-[#0b1825] text-white" : "border-[#dde4cc] text-[#71818a]"}`}>
              {form.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              {form.active ? "Active — visible to students" : "Inactive — hidden from students"}
            </button>
          </div>
          {formErr && <p className="mt-3 text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle size={13} />{formErr}</p>}
          <div className="flex gap-2 mt-4">
            <Btn onClick={save}><Check size={14} /> {editId ? "Save changes" : "Add"}</Btn>
            <Btn variant="secondary" onClick={() => setShowForm(false)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {/* List */}
      <div className="space-y-3">
        {state.specializations.length === 0 && (
          <Card className="p-8 text-center">
            <BookOpen size={28} className="text-[#dde4cc] mx-auto mb-3" />
            <p className="text-sm text-[#71818a]">No specializations yet. Add one to get started.</p>
          </Card>
        )}
        {state.specializations.map((spec, i) => {
          const pal = specPalette(i);
          const studentCount = state.students.filter((s) => s.chosenSpecialization === spec.name).length;
          return (
            <Card key={spec.id} className={`p-4 ${!spec.active ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-4">
                <div className={`h-3 w-3 rounded-full mt-1 shrink-0 ${pal.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-[#0b1825]">{spec.name}</p>
                    <Badge color="default">{spec.batch}</Badge>
                    <Badge color={spec.active ? "lime" : "yellow"}>{spec.active ? "Active" : "Inactive"}</Badge>
                    {studentCount > 0 && <Badge color="blue">{studentCount} selected</Badge>}
                  </div>
                  {spec.description && <p className="text-xs text-[#71818a] mt-1">{spec.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggle(spec.id)}                    title={spec.active ? "Deactivate" : "Activate"}
                    className="text-[#71818a] hover:text-[#0b1825] transition">
                    {spec.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                  <button onClick={() => openEdit(spec)} className="text-[#71818a] hover:text-[#0b1825] transition"><Pencil size={14} /></button>
                  <button onClick={() => remove(spec.id, spec.name)} className="text-[#71818a] hover:text-red-600 transition"><Trash2 size={14} /></button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Spec window
// ─────────────────────────────────────────────────────────────────
function AdminSpecWindow({ state, showToast, setState, session }: {
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  session: NonNullable<Session>;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  const isOpen = state.phase === "SPEC_WINDOW_OPEN";
  const activeSpecs = state.specializations.filter((s) => s.active);

  const closeWindow = async () => {
    if (activeSpecs.length === 0) { showToast("No active specializations. Add some first.", true); return; }
    const selected = state.students.filter((s) => s.chosenSpecialization !== null).length;
    if (selected === 0) { showToast("No students have selected a specialization yet.", true); return; }
    try {
      // Auto-create sections in DB via POST /api/admin-config
      const res = await fetch("/api/admin-config", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken ?? ""}` },
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? "Failed to close window.", true); return; }
      // Reload sections from DB and update phase in local state
      setState((p) => ({ ...p, phase: "SPEC_WINDOW_CLOSED", specWindowStatus: "CLOSED" }));
      // Reload sections from DB
      const secRes = await fetch("/api/admin-sections", { headers: { Authorization: `Bearer ${session.accessToken ?? ""}` } });
      if (secRes.ok) {
        const secData = await secRes.json();
        const sections = (secData.data ?? []).map((s: any) => ({
          id: s.id, name: s.name, capacity: s.capacity,
          specializationId: s.specialization_id,
          specializationName: s.specialization?.name ?? "",
          occupancy: s.occupancy ?? 0,
        }));
        setState((p) => ({ ...p, sections }));
      }
      showToast(`Window closed. ${data.sectionsCreated ?? 0} sections created.`);
    } catch { showToast("Network error. Try again.", true); }
  };

  const reopenWindow = async () => {
    try {
      const res = await fetch("/api/admin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ phase: "SPEC_WINDOW_OPEN" }),
      });
      if (!res.ok) { showToast("Failed to reopen window.", true); return; }
      setState((p) => ({ ...p, phase: "SPEC_WINDOW_OPEN", specWindowStatus: "OPEN", sections: [] }));
      showToast("Specialization window reopened.");
    } catch { showToast("Network error. Try again.", true); }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-[#0b1825] text-lg">Specialization selection window</h3>
            <p className="text-xs text-[#71818a] mt-0.5">Controls whether students can choose their specialization</p>
          </div>
          <Badge color={isOpen ? "lime" : "red"}>{isOpen ? "OPEN" : "CLOSED"}</Badge>
        </div>
        <div className="rounded-xl bg-[#f9faf3] border border-[#eef0e4] p-4 space-y-2">
          {activeSpecs.map((spec, i) => {
            const count = state.students.filter((s) => s.chosenSpecialization === spec.name).length;
            return (
              <div key={spec.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${specPalette(i).dot}`} />{spec.name}
                </span>
                <span className="font-semibold text-[#0b1825]">{count} students</span>
              </div>
            );
          })}
          <div className="pt-2 border-t border-[#eef0e4] flex items-center justify-between text-sm font-bold text-[#0b1825]">
            <span>Total responded</span>
            <span>{state.students.filter((s) => s.chosenSpecialization !== null).length} / {state.students.length}</span>
          </div>
        </div>
        {isOpen ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Closing will auto-generate sections (target 50 students/section). You can adjust before opening section selection.
            </div>
            <Btn variant="danger" onClick={closeWindow} className="w-full">
              <Lock size={15} /> Close window &amp; generate sections
            </Btn>
          </div>
        ) : (
          <Btn variant="secondary" onClick={reopenWindow} className="w-full">Reopen specialization window</Btn>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Sections
// ─────────────────────────────────────────────────────────────────

/** Download final allocation Excel — same format as the uploaded sheet */
function downloadAllocationExcel(state: AppState) {
  const rows = state.students
    .filter((s) => s.chosenSpecialization)
    .map((s) => {
      const sec = state.sections.find((sc) => sc.id === s.assignedSectionId);
      return {
        "Student Name":   s.name,
        "Roll No.":       s.rollNumber,
        "NCU Email Id":   s.email,
        "Specialization": s.chosenSpecialization ?? "—",
        "Section":        sec?.name ?? "—",
        "Group":          s.group ? `G${s.group}` : "—",
      };
    });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 28 }, { wch: 14 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Section Allocation");
  XLSX.writeFile(wb, "section-allocation.xlsx");
}

function AdminSections({ state, showToast, setState, session }: {
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  session: NonNullable<Session>;
}) {
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSecName, setNewSecName] = useState("");
  const [newSecSpec, setNewSecSpec] = useState("");

  const canAdjust   = state.phase === "SPEC_WINDOW_CLOSED" || state.phase === "SECTIONS_FINALIZED" || state.phase === "SECTION_WINDOW_OPEN";
  const canFinalize = state.phase === "SPEC_WINDOW_CLOSED";
  const isLocked    = state.phase === "SECTIONS_FINALIZED" || state.phase === "SECTION_WINDOW_OPEN" || state.phase === "SECTION_WINDOW_CLOSED";
  const canExport   = state.phase === "SECTION_WINDOW_CLOSED";

  const updateCap = (id: string, val: number) =>
    setState((p) => ({ ...p, sections: p.sections.map((s) => s.id === id ? { ...s, capacity: Math.max(0, val) } : s) }));

  const finalize = async () => {
    // Save all section capacities to DB first, then update phase
    try {
      await Promise.all(state.sections.map((s) =>
        fetch("/api/admin-sections", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
          body: JSON.stringify({ id: s.id, capacity: s.capacity }),
        })
      ));
      const res = await fetch("/api/admin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ phase: "SECTIONS_FINALIZED" }),
      });
      if (!res.ok) { showToast("Failed to finalize.", true); return; }
      setState((p) => ({ ...p, phase: "SECTIONS_FINALIZED" }));
      showToast("Sections finalized. You can now open the section-selection window.");
    } catch { showToast("Network error.", true); }
  };

  // Unlock — revert to SPEC_WINDOW_CLOSED so admin can adjust again
  const unlock = async () => {
    try {
      const res = await fetch("/api/admin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ phase: "SPEC_WINDOW_CLOSED" }),
      });
      if (!res.ok) { showToast("Failed to unlock.", true); return; }
      setState((p) => ({ ...p, phase: "SPEC_WINDOW_CLOSED" }));
      showToast("Sections unlocked. Adjust capacities and finalize again.");
    } catch { showToast("Network error.", true); }
  };

  // Add a section manually
  const addSection = async () => {
    if (!newSecName.trim() || !newSecSpec) {
      showToast("Enter a section name and pick a specialization.", true); return;
    }
    const dup = state.sections.find(
      (s) => s.specializationName === newSecSpec && s.name.toLowerCase() === newSecName.trim().toLowerCase()
    );
    if (dup) { showToast("A section with that name already exists.", true); return; }
    const spec = state.specializations.find((s) => s.name === newSecSpec);
    if (!spec) { showToast("Specialization not found.", true); return; }
    try {
      const res = await fetch("/api/admin-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ specialization_id: spec.id, name: newSecName.trim(), capacity: 0 }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? "Failed to add section.", true); return; }
      const newSec: Section = {
        id: data.id ?? `${newSecSpec.toLowerCase().replace(/[/ ]/g, "-")}-${Date.now()}`,
        specializationName: newSecSpec,
        name: newSecName.trim(),
        capacity: 0,
      };
      setState((p) => ({ ...p, sections: [...p.sections, newSec] }));
      setNewSecName(""); setNewSecSpec(""); setShowAddSection(false);
      showToast(`${newSec.name} added to ${newSecSpec}.`);
    } catch { showToast("Network error.", true); }
  };

  // Delete section — only if no students seated
  const deleteSection = async (sec: Section) => {
    const seated = state.students.filter((s) => s.assignedSectionId === sec.id).length;
    if (seated > 0) {
      showToast(`Cannot delete — ${seated} student(s) already in ${sec.name}.`, true); return;
    }
    try {
      const res = await fetch(`/api/admin-sections?id=${sec.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken ?? ""}` },
      });
      if (!res.ok) { showToast("Failed to delete section.", true); return; }
      setState((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== sec.id) }));
      showToast(`${sec.name} deleted.`);
    } catch { showToast("Network error.", true); }
  };

  if (state.sections.length === 0) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Card className="p-10 text-center">
          <Table2 size={32} className="text-[#dde4cc] mx-auto mb-3" />
          <p className="text-sm text-[#71818a]">No sections yet. Close the specialization window to auto-generate sections.</p>
        </Card>
      </div>
    );
  }

  const specNames = [...new Set(state.sections.map((s) => s.specializationName))];

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0b1825]">Section management</h2>
          <p className="text-sm text-[#71818a] mt-0.5">{state.sections.length} sections. Adjust capacities if needed.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canExport && (
            <Btn variant="secondary" onClick={() => downloadAllocationExcel(state)}>
              <Download size={14} /> Export Excel
            </Btn>
          )}
          {canAdjust && (
            <Btn variant="secondary" onClick={() => setShowAddSection((v) => !v)}>
              <Plus size={14} /> Add section
            </Btn>
          )}
          {isLocked && state.phase !== "SECTION_WINDOW_OPEN" && (
            <Btn variant="secondary" onClick={unlock}>
              <Lock size={14} /> Unlock sections
            </Btn>
          )}
          {canFinalize && (
            <Btn variant="lime" onClick={finalize}><CheckCircle2 size={15} /> Finalize sections</Btn>
          )}
        </div>
      </div>

      {/* Add section form */}
      {showAddSection && (
        <Card className="p-4">
          <h3 className="font-semibold text-[#0b1825] mb-3 text-sm">Add section manually</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-[#71818a] mb-1">Specialization</label>
              <select value={newSecSpec} onChange={(e) => setNewSecSpec(e.target.value)}
                className="rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-3 py-2 text-sm outline-none focus:border-[#0b1825]">
                <option value="">Select…</option>
                {state.specializations.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#71818a] mb-1">Section name</label>
              <input value={newSecName} onChange={(e) => setNewSecName(e.target.value)}
                placeholder="e.g. Section F"
                className="rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-3 py-2 text-sm outline-none focus:border-[#0b1825] w-40" />
            </div>
            <Btn onClick={addSection}><Check size={14} /> Add</Btn>
            <Btn variant="secondary" onClick={() => setShowAddSection(false)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {state.phase === "SPEC_WINDOW_CLOSED" && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          Review sections. Set capacities, then click <strong>Finalize sections</strong> to proceed.
        </div>
      )}
      {specNames.map((specName, si) => {
        const secs = state.sections.filter((s) => s.specializationName === specName);
        const spCount = state.students.filter((s) => s.chosenSpecialization === specName).length;
        const totalCap = secs.reduce((a, s) => a + s.capacity, 0);
        const pal = specPalette(si);
        return (
          <Card key={specName} className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[#eef0e4] flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${pal.dot}`} />
              <h3 className="font-semibold text-[#0b1825]">{specName}</h3>
              <span className="text-xs text-[#71818a]">{spCount} students selected</span>
              <span className={`ml-auto text-xs font-semibold ${totalCap < spCount ? "text-red-600" : "text-emerald-700"}`}>
                Capacity: {totalCap}{totalCap !== spCount && ` (≠ ${spCount} students)`}
              </span>
            </div>
            <div className="divide-y divide-[#f5f6ef]">
              {secs.map((sec) => {
                const taken = takenSeats(sec, state.students).length;
                const pct   = sec.capacity > 0 ? Math.min(100, Math.round((taken / sec.capacity) * 100)) : 0;
                return (
                  <div key={sec.id} className="px-5 py-4 flex items-center gap-4">
                    <div className="flex-1">
                      <p className="font-medium text-[#0b1825]">{sec.name}</p>
                      <p className="text-xs text-[#71818a]">{taken} seats taken</p>
                    </div>
                    {canAdjust ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#71818a]">Capacity:</span>
                        <input type="number" min={0} value={sec.capacity}
                          onChange={(e) => updateCap(sec.id, parseInt(e.target.value) || 0)}
                          className="w-20 rounded-lg border border-[#dde4cc] bg-[#f9faf3] px-3 py-1.5 text-sm text-center outline-none focus:border-[#0b1825]" />
                      </div>
                    ) : (
                      <span className="text-sm font-semibold text-[#0b1825]">{sec.capacity} seats</span>
                    )}
                    <div className="w-24">
                      <div className="h-1.5 bg-[#f0f2e4] rounded-full overflow-hidden">
                        <div className="h-full bg-[#d8ff5b] rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-[#71818a] mt-0.5 text-right">{taken}/{sec.capacity}</p>
                    </div>
                    {canAdjust && (
                      <button onClick={() => deleteSection(sec)} title="Delete section"
                        className="text-[#71818a] hover:text-red-600 transition shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Section window
// ─────────────────────────────────────────────────────────────────
function AdminSectionWindow({ state, showToast, setState, session }: {
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  session: NonNullable<Session>;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  const canOpen = state.phase === "SECTIONS_FINALIZED" || state.phase === "SECTION_WINDOW_CLOSED";
  const isOpen  = state.phase === "SECTION_WINDOW_OPEN";
  const seated  = state.students.filter((s) => s.assignedSectionId !== null).length;

  const handleCloseWindow = async () => {
    try {
      const res = await fetch("/api/admin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ phase: "SECTION_WINDOW_CLOSED" }),
      });
      if (!res.ok) { showToast("Failed to close window.", true); return; }
    } catch { showToast("Network error. Try again.", true); return; }
    setState((p) => ({ ...p, phase: "SECTION_WINDOW_CLOSED", sectionWindowStatus: "CLOSED" }));
    // Assign G1/G2 groups to all seated students
    const students = state.students.filter((s) => s.assignedSectionId !== null);
    const bySection: Record<string, Student[]> = {};
    for (const s of students) {
      if (!s.assignedSectionId) continue;
      if (!bySection[s.assignedSectionId]) bySection[s.assignedSectionId] = [];
      bySection[s.assignedSectionId].push(s);
    }
    const updates: Record<string, 1 | 2> = {};
    for (const sectionStudents of Object.values(bySection)) {
      const sorted = [...sectionStudents].sort((a, b) => (a.assignedSeat ?? 0) - (b.assignedSeat ?? 0));
      const half = Math.ceil(sorted.length / 2);
      sorted.forEach((s, i) => { updates[s.id] = i < half ? 1 : 2; });
    }
    setState((p) => ({
      ...p,
      students: p.students.map((s) =>
        updates[s.id] !== undefined ? { ...s, group: updates[s.id] } : s
      ),
    }));
    const g1 = Object.values(updates).filter((g) => g === 1).length;
    const g2 = Object.values(updates).filter((g) => g === 2).length;
    showToast(`Window closed. Groups assigned: G1 = ${g1}, G2 = ${g2}.`);
    // Persist group assignments to DB in background
    void (async () => {
      try {
        await Promise.all(Object.entries(updates).map(([studentId, group]) =>
          fetch("/api/admin-students", {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
            body: JSON.stringify({ id: studentId, group_number: group }),
          })
        ));
      } catch { /* non-critical — groups will be recalculated if needed */ }
    })();
  };

  const exportExcel = () => downloadAllocationExcel(state);

  return (
    <div className="space-y-5 max-w-2xl">
      <Card className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-[#0b1825] text-lg">Section-selection window</h3>
            <p className="text-xs text-[#71818a] mt-0.5">When open, students can pick their section and seat</p>
          </div>
          <Badge color={isOpen ? "lime" : "red"}>{isOpen ? "OPEN" : "CLOSED"}</Badge>
        </div>
        {(state.phase === "SPEC_WINDOW_OPEN" || state.phase === "SPEC_WINDOW_CLOSED") ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            Finalize sections before opening section selection.
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-[#f9faf3] border border-[#eef0e4] p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[#71818a]">Students seated</span><span className="font-bold text-[#0b1825]">{seated} / {state.students.length}</span></div>
              <div className="flex justify-between"><span className="text-[#71818a]">Sections available</span><span className="font-bold text-[#0b1825]">{state.sections.length}</span></div>
            </div>
            {isOpen
              ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
                    Closing this window will <strong>automatically split each section into G1 and G2</strong> based on seat order. Lower seat numbers → G1, higher → G2, split as evenly as possible.
                  </div>
                  <Btn variant="danger" onClick={handleCloseWindow} className="w-full"><Lock size={15} /> Close window &amp; assign groups</Btn>
                </div>
              )
              : (
                <div className="space-y-3">
                  <Btn variant="lime" onClick={async () => {
                    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                    try {
                      const res = await fetch("/api/admin-config", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
                        body: JSON.stringify({ phase: "SECTION_WINDOW_OPEN", section_window_deadline: deadline }),
                      });
                      if (!res.ok) { showToast("Failed to open window.", true); return; }
                      setState((p) => ({ ...p, phase: "SECTION_WINDOW_OPEN", sectionWindowStatus: "OPEN", sectionWindowDeadline: deadline }));
                      showToast("Section-selection window opened.");
                    } catch { showToast("Network error.", true); }
                  }} disabled={!canOpen} className="w-full"><CheckCircle2 size={15} /> Open section-selection window</Btn>
                  {state.phase === "SECTION_WINDOW_CLOSED" && (
                    <Btn variant="secondary" onClick={exportExcel} className="w-full"><Download size={14} /> Download allocation Excel</Btn>
                  )}
                </div>
              )
            }
          </>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — All students view
// ─────────────────────────────────────────────────────────────────
function AdminStudents({ state }: { state: AppState }) {
  const [filterSpec, setFilterSpec] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const activeSpecs = state.specializations.filter((s) => s.active);

  const visible = state.students.filter((s) => {
    const mSpec = filterSpec === "all" || s.chosenSpecialization === filterSpec;
    const q = search.toLowerCase();
    const mQ = !q || s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
    return mSpec && mQ;
  });

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSearch = (val: string) => { setSearch(val); setPage(1); };
  const handleFilter = (val: string) => { setFilterSpec(val); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search name, roll, email…"
          className="rounded-xl border border-[#dde4cc] bg-white px-3 py-2 text-sm outline-none focus:border-[#0b1825] w-56" />
        <button onClick={() => handleFilter("all")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition ${filterSpec === "all" ? "bg-[#0b1825] text-white border-[#0b1825]" : "border-[#dde4cc] hover:bg-[#f0f2e4]"}`}>
          All ({state.students.length})
        </button>
        {activeSpecs.map((sp, i) => {
          const cnt = state.students.filter((s) => s.chosenSpecialization === sp.name).length;
          return (
            <button key={sp.id} onClick={() => handleFilter(sp.name)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition ${filterSpec === sp.name ? "bg-[#0b1825] text-white border-[#0b1825]" : "border-[#dde4cc] hover:bg-[#f0f2e4]"}`}>
              {sp.name} ({cnt})
            </button>
          );
        })}
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#eef0e4] bg-[#f9faf3]">
                {["Roll No.", "Name", "Email", "Specialization", "Section", "Group"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-[#71818a] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f6ef]">
              {paginated.map((s) => {
                const sec = state.sections.find((sc) => sc.id === s.assignedSectionId);
                const specIdx = state.specializations.findIndex((sp) => sp.name === s.chosenSpecialization);
                const pal = specIdx >= 0 ? specPalette(specIdx) : null;
                return (
                  <tr key={s.id} className="hover:bg-[#fafbf5] transition">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#71818a]">{s.rollNumber}</td>
                    <td className="px-4 py-2.5 font-medium text-[#0b1825]">{s.name}</td>
                    <td className="px-4 py-2.5 text-xs text-[#71818a]">{s.email}</td>
                    <td className="px-4 py-2.5">
                      {s.chosenSpecialization && pal
                        ? <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${pal.badge}`}>{s.chosenSpecialization}</span>
                        : <span className="text-[#71818a] text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#71818a]">{sec?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {s.group
                        ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${s.group === 1 ? "bg-blue-100 text-blue-800" : "bg-violet-100 text-violet-800"}`}>G{s.group}</span>
                        : <span className="text-[#71818a]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="px-5 py-3 border-t border-[#eef0e4] flex items-center justify-between gap-4">
          <span className="text-xs text-[#71818a]">
            {visible.length === 0
              ? "No students match."
              : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visible.length)} of ${visible.length} students`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#dde4cc] text-[#71818a] hover:bg-[#f5f6ef] disabled:opacity-30 disabled:cursor-not-allowed transition">
                <ChevronRight size={14} className="rotate-180" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                  acc.push(p); return acc;
                }, [])
                .map((p, idx) =>
                  p === "…"
                    ? <span key={`e-${idx}`} className="h-8 w-8 flex items-center justify-center text-xs text-[#71818a]">…</span>
                    : <button key={p} onClick={() => setPage(p as number)}
                        className={`h-8 w-8 flex items-center justify-center rounded-lg text-xs font-semibold border transition
                          ${currentPage === p ? "bg-[#0b1825] text-white border-[#0b1825]" : "border-[#dde4cc] text-[#71818a] hover:bg-[#f5f6ef]"}`}>
                        {p}
                      </button>
                )}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#dde4cc] text-[#71818a] hover:bg-[#f5f6ef] disabled:opacity-30 disabled:cursor-not-allowed transition">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Student list management (Excel / PDF / CSV)
// ─────────────────────────────────────────────────────────────────
function normaliseRow(cols: string[]): { name: string; rollNumber: string; email: string } | null {
  let name = "", rollNumber = "", email = "";
  for (const c of cols) {
    const v = c.trim();
    if (!v) continue;
    if (!email && v.includes("@") && v.includes(".")) { email = v.toLowerCase(); continue; }
    if (!rollNumber && /\b\d{2}[a-zA-Z]{2,4}\d{3}\b/i.test(v)) { rollNumber = v.toUpperCase(); continue; }
    // Skip serial numbers (purely numeric values like 1, 2, 3)
    if (/^\d+$/.test(v)) continue;
    if (!name) { name = v; continue; }
  }
  if (!email) return null;
  return { name, rollNumber, email };
}

function AdminStudentList({ state, showToast, setState, session }: {
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  session: NonNullable<Session>;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", rollNumber: "", email: "" });
  const [formErr, setFormErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState<"add" | "replace">("add");
  const [uploadPreview, setUploadPreview] = useState<{ rows: Student[]; fileName: string } | null>(null);

  const PAGE_SIZE = 25;

  // Load students from Supabase on mount and after uploads
  const loadStudentsFromSupabase = async () => {
    try {
      const tok = await getToken();
      const res = await fetch("/api/admin-students", {
        headers: { Authorization: `Bearer ${tok}` }
      });
      if (res.ok) {
        const { data } = await res.json();
        const students: Student[] = (data ?? []).map((s: any) => ({
          id:                   s.id,
          rollNumber:           s.roll_number,
          name:                 s.name,
          email:                s.email,
          // Resolve UUID to name so comparisons work consistently
          chosenSpecialization: s.chosen_specialization_id
            ? (state.specializations.find((sp) => sp.id === s.chosen_specialization_id)?.name ?? null)
            : null,
          assignedSectionId:    s.assigned_section_id ?? null,
          assignedSeat:         s.assigned_seat ?? null,
          group:                s.group_number ?? null,
        }));
        setState((p) => ({ ...p, students }));
      }
    } catch { /* silently ignore */ }
  };

  useEffect(() => { loadStudentsFromSupabase(); }, []);

  const filtered = state.students.filter((s) => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  function rowsToStudents(rows: { name: string; rollNumber: string; email: string }[]): Student[] {
    return rows.filter((r) => r.email).map((r, i) => ({
      id: `student-upload-${Date.now()}-${i}`,
      name: r.name || r.email.split("@")[0],
      rollNumber: r.rollNumber || "—",
      email: r.email,
      chosenSpecialization: null,
      assignedSectionId: null,
      assignedSeat: null,
      group: null,
    }));
  }

  async function parseExcel(file: File): Promise<Student[]> {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: "array" });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const firstCell = String(raw[0]?.[0] ?? "").toLowerCase();
    const data = firstCell.includes("name") || firstCell.includes("roll") || firstCell.includes("s.no") ? raw.slice(1) : raw;
    return rowsToStudents(data.map((row) => normaliseRow(row.map(String))).filter(Boolean) as { name: string; rollNumber: string; email: string }[]);
  }

  async function parseCsv(file: File): Promise<Student[]> {
    const text = await file.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0]?.toLowerCase() ?? "";
    const data = firstLine.includes("name") || firstLine.includes("roll") ? lines.slice(1) : lines;
    return rowsToStudents(
      data.map((line) => normaliseRow(line.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim())))
        .filter(Boolean) as { name: string; rollNumber: string; email: string }[]
    );
  }

  async function parsePdf(file: File): Promise<Student[]> {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
    const buf  = await file.arrayBuffer();
    const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
    let fullText = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      fullText += (content.items as any[]).map((item) => item.str).join(" ") + "\n";
    }
    const emails = [...fullText.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)].map((m) => m[0].toLowerCase());
    const rolls  = [...fullText.matchAll(/\b\d{2}[a-zA-Z]{2,4}\d{3}\b/gi)].map((m) => m[0].toUpperCase());
    if (emails.length === 0) throw new Error("No email addresses found in the PDF. Make sure it is text-based, not a scanned image.");
    return rowsToStudents(emails.map((email, i) => ({ name: email.split("@")[0], rollNumber: rolls[i] ?? "—", email })));
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, mode: "add" | "replace") => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setUploadMode(mode);
    try {
      const nm = file.name.toLowerCase();
      let parsed: Student[] = [];
      if (nm.endsWith(".xlsx") || nm.endsWith(".xls") || nm.endsWith(".ods")) parsed = await parseExcel(file);
      else if (nm.endsWith(".csv"))  parsed = await parseCsv(file);
      else if (nm.endsWith(".pdf"))  parsed = await parsePdf(file);
      else { showToast("Unsupported file type. Use .xlsx, .xls, .csv, or .pdf", true); setUploading(false); return; }
      if (parsed.length === 0) { showToast("No student records found in the file.", true); setUploading(false); return; }
      setUploadPreview({ rows: parsed, fileName: file.name });
    } catch (err: any) {
      showToast(err.message ?? "Failed to parse file.", true);
    }
    setUploading(false);
  };

  const commitUpload = async () => {
    if (!uploadPreview) return;
    const { rows } = uploadPreview;

    const toSave = uploadMode === "replace"
      ? rows
      : rows.filter((n) => !state.students.some((e) => e.email === n.email));

    // accessToken is cached on the session object at sign-in (and restored
    // on refresh), since signIn() persists the session via supabase.auth.setSession
    const token = session.accessToken ?? "";

    if (!token) {
      showToast("Session expired. Please sign in again.", true);
      return;
    }

    try {
      const apiRows = toSave.map((s) => ({
        name: s.name,
        roll_number: s.rollNumber,
        email: s.email,
      }));
      const res = await fetch("/api/admin-students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ students: apiRows, replace: uploadMode === "replace" }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to save students.", true);
        return;
      }
      showToast(`Saved ${data.inserted ?? toSave.length} students. Auth accounts created with default password.`);
    } catch {
      showToast("Network error saving students.", true);
      return;
    }

    if (uploadMode === "replace") {
      setState((p) => ({ ...p, students: rows }));
    } else {
      setState((p) => ({ ...p, students: [...p.students, ...toSave] }));
    }
    setUploadPreview(null);
    // Reload from Supabase to get accurate data
    setTimeout(() => loadStudentsFromSupabase(), 1000);
  };

  const getToken = async () => {
    // accessToken is cached on the session object at sign-in and on refresh
    // restore; fall back to getSession() as a safety net.
    if (session.accessToken) return session.accessToken;
    const { data: { session: s } } = await supabase.auth.getSession();
    return s?.access_token ?? "";
  };

  const openAdd = () => { setForm({ name: "", rollNumber: "", email: "" }); setFormErr(""); setEditId(null); setShowAdd(true); };
  const openEdit = (s: Student) => { setForm({ name: s.name, rollNumber: s.rollNumber, email: s.email }); setFormErr(""); setEditId(s.id); setShowAdd(true); };

  const saveStudent = async () => {
    setFormErr("");
    const { name, rollNumber, email } = form;
    if (!name.trim() || !rollNumber.trim() || !email.trim()) { setFormErr("All fields are required."); return; }
    if (!email.includes("@")) { setFormErr("Invalid email address."); return; }
    const dup = state.students.find((s) => s.email.toLowerCase() === email.toLowerCase() && s.id !== editId);
    if (dup) { setFormErr("A student with this email already exists."); return; }
    const tok = await getToken();

    if (editId) {
      // Update in Supabase
      try {
        const res = await fetch("/api/admin-students", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ id: editId, name: name.trim(), roll_number: rollNumber.trim(), email: email.trim().toLowerCase() }),
        });
        if (!res.ok) { const d = await res.json(); setFormErr(d.error ?? "Failed to update."); return; }
      } catch { setFormErr("Network error."); return; }
      setState((p) => ({ ...p, students: p.students.map((s) => s.id === editId ? { ...s, name: name.trim(), rollNumber: rollNumber.trim(), email: email.trim().toLowerCase() } : s) }));
      showToast("Student updated.");
    } else {
      // Add to Supabase
      try {
        const res = await fetch("/api/admin-students", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ name: name.trim(), roll_number: rollNumber.trim(), email: email.trim().toLowerCase() }),
        });
        if (!res.ok) { const d = await res.json(); setFormErr(d.error ?? "Failed to add student."); return; }
      } catch { setFormErr("Network error."); return; }
      setState((p) => ({ ...p, students: [...p.students, { id: `student-${Date.now()}`, name: name.trim(), rollNumber: rollNumber.trim(), email: email.trim().toLowerCase(), chosenSpecialization: null, assignedSectionId: null, assignedSeat: null, group: null }] }));
      showToast("Student added.");
    }
    setShowAdd(false);
  };

  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  const deleteAllStudents = async () => {
    setDeletingAll(true);
    const tok = await getToken();
    try {
      // Delete all students
      const res = await fetch("/api/admin-students?deleteAll=1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? "Failed to delete.", true); return; }

      // Delete all sections (cascades to seats via ON DELETE CASCADE in DB)
      await fetch("/api/admin-sections?deleteAll=1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });

      // Reset phase back to SPEC_WINDOW_OPEN (fresh start)
      await fetch("/api/admin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ phase: "SPEC_WINDOW_OPEN" }),
      });

      setState((p) => ({
        ...p,
        students: [],
        sections: [],
        phase: "SPEC_WINDOW_OPEN",
        specWindowStatus: "OPEN",
        sectionWindowStatus: "CLOSED",
      }));
      showToast("All students, sections, and seat allocations deleted.");
      setConfirmDeleteAll(false);
    } catch { showToast("Network error.", true); }
    setDeletingAll(false);
  };

  const removeStudent = async (id: string) => {
    const tok = await getToken();
    try {
      const res = await fetch(`/api/admin-students?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? "Failed to remove.", true); return; }
    } catch { showToast("Network error.", true); return; }
    setState((p) => ({ ...p, students: p.students.filter((s) => s.id !== id) }));
    showToast("Student removed.");
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Roll Number", "Email"],
      ["Kumkum Singh", "22CSU001", "22csu001@ncuindia.edu"],
      ["Aarav Mehta",  "22CSU002", "22csu002@ncuindia.edu"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "students-template.xlsx");
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="font-display text-xl font-bold text-[#0b1825]">Student list management</h2>
          <p className="text-sm text-[#71818a] mt-0.5">{state.students.length} authorized students</p>
        </div>
        <Btn variant="secondary" onClick={downloadTemplate}><Download size={14} /> Excel template</Btn>
        {!confirmDeleteAll
          ? <Btn variant="danger" onClick={() => setConfirmDeleteAll(true)} disabled={state.students.length === 0}><Trash2 size={14} /> Delete entire list</Btn>
          : <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm">
              <span className="text-red-700 font-medium">Delete all {state.students.length} students, sections, groups &amp; seats?</span>
              <Btn variant="danger" onClick={deleteAllStudents} disabled={deletingAll}>{deletingAll ? "Deleting…" : "Yes, delete everything"}</Btn>
              <Btn variant="secondary" onClick={() => setConfirmDeleteAll(false)}>Cancel</Btn>
            </div>
        }
        <Btn variant="primary" onClick={openAdd}><Plus size={14} /> Add student</Btn>
      </div>

      {/* Upload zone */}
      <Card className="p-5">
        <h3 className="font-semibold text-[#0b1825] mb-1">Upload student database</h3>
        <p className="text-xs text-[#71818a] mb-4">
          Supports <strong>.xlsx / .xls</strong> (Excel), <strong>.csv</strong>, text-based <strong>.pdf</strong>.
          Columns auto-detected. Students must have <code className="bg-[#f0f2e4] px-1 rounded">@ncuindia.edu</code> emails.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#dde4cc] bg-[#f9faf3] py-8 cursor-pointer hover:border-[#0b1825]/40 hover:bg-[#f5f6ef] transition ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            <Upload size={22} className="text-[#71818a]" />
            <span className="text-sm font-semibold text-[#0b1825]">Add from file</span>
            <span className="text-xs text-[#71818a]">Merges with existing list</span>
            <input type="file" accept=".xlsx,.xls,.csv,.pdf,.ods" className="hidden" onChange={(e) => handleUpload(e, "add")} />
          </label>
          <label className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 py-8 cursor-pointer hover:border-amber-500 hover:bg-amber-100 transition ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            <Upload size={22} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">Replace all from file</span>
            <span className="text-xs text-amber-600">Clears existing list first</span>
            <input type="file" accept=".xlsx,.xls,.csv,.pdf,.ods" className="hidden" onChange={(e) => handleUpload(e, "replace")} />
          </label>
        </div>
        {uploading && (
          <div className="mt-3 flex items-center gap-2 text-sm text-[#71818a]">
            <div className="h-4 w-4 rounded-full border-2 border-[#0b1825] border-t-transparent animate-spin" />
            Parsing file…
          </div>
        )}
      </Card>

      {/* Preview */}
      {uploadPreview && (
        <Card className="p-5 border-2 border-[#d8ff5b]">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="font-semibold text-[#0b1825]">Preview — {uploadPreview.fileName}</h3>
              <p className="text-sm text-[#71818a] mt-0.5">{uploadPreview.rows.length} records extracted. Review before confirming.</p>
            </div>
            <button onClick={() => setUploadPreview(null)} className="text-[#71818a] hover:text-[#0b1825]"><X size={16} /></button>
          </div>
          <div className="rounded-xl border border-[#dde4cc] overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead><tr className="bg-[#f9faf3] border-b border-[#eef0e4]">
                <th className="text-left px-3 py-2 font-semibold text-[#71818a]">Name</th>
                <th className="text-left px-3 py-2 font-semibold text-[#71818a]">Roll No.</th>
                <th className="text-left px-3 py-2 font-semibold text-[#71818a]">Email</th>
              </tr></thead>
              <tbody className="divide-y divide-[#f5f6ef]">
                {uploadPreview.rows.slice(0, 8).map((s, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-[#0b1825]">{s.name}</td>
                    <td className="px-3 py-2 font-mono text-[#71818a]">{s.rollNumber}</td>
                    <td className="px-3 py-2 text-[#71818a]">{s.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {uploadPreview.rows.length > 8 && <div className="px-3 py-2 border-t border-[#eef0e4] text-xs text-[#71818a]">…and {uploadPreview.rows.length - 8} more rows</div>}
          </div>
          <div className="flex gap-3">
            <Btn onClick={commitUpload} variant={uploadMode === "replace" ? "danger" : "primary"}>
              <Check size={14} /> {uploadMode === "replace" ? "Replace entire list" : "Add to existing list"}
            </Btn>
            <Btn variant="secondary" onClick={() => setUploadPreview(null)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {showAdd && (
        <Card className="p-5">
          <h3 className="font-semibold text-[#0b1825] mb-4">{editId ? "Edit student" : "Add student"}</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input label="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Kumkum Singh" />
            <Input label="Roll number" value={form.rollNumber} onChange={(e) => setForm((f) => ({ ...f, rollNumber: e.target.value }))} placeholder="22CSU001" />
            <Input label="Email (@ncuindia.edu)" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="22csu001@ncuindia.edu" />
          </div>
          {formErr && <p className="mt-2 text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle size={13} />{formErr}</p>}
          <div className="flex gap-2 mt-4">
            <Btn onClick={saveStudent}><Check size={14} /> {editId ? "Save changes" : "Add student"}</Btn>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn>
          </div>
        </Card>
      )}

      <input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search name, roll, or email…"
        className="rounded-xl border border-[#dde4cc] bg-white px-3 py-2 text-sm outline-none focus:border-[#0b1825] w-full sm:w-72" />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#eef0e4] bg-[#f9faf3]">
                <th className="text-left px-4 py-3 font-semibold text-[#71818a]">Roll No.</th>
                <th className="text-left px-4 py-3 font-semibold text-[#71818a]">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-[#71818a]">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-[#71818a]">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f6ef]">
              {paginated.map((s) => (
                <tr key={s.id} className="hover:bg-[#fafbf5] transition">
                  <td className="px-4 py-2.5 font-mono text-xs text-[#71818a]">{s.rollNumber}</td>
                  <td className="px-4 py-2.5 font-medium text-[#0b1825]">{s.name}</td>
                  <td className="px-4 py-2.5 text-xs text-[#71818a]">{s.email}</td>
                  <td className="px-4 py-2.5">
                    {s.chosenSpecialization ? <Badge color="green">Spec selected</Badge> : <Badge color="yellow">Pending</Badge>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(s)} className="text-[#71818a] hover:text-[#0b1825] transition"><Pencil size={13} /></button>
                      <button onClick={() => removeStudent(s.id)} className="text-[#71818a] hover:text-red-600 transition"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="px-5 py-3 border-t border-[#eef0e4] flex items-center justify-between gap-4">
          <span className="text-xs text-[#71818a]">
            {filtered.length === 0
              ? "No students match your search."
              : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length} students`}
          </span>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              {/* Prev */}
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#dde4cc] text-[#71818a] hover:bg-[#f5f6ef] disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronRight size={14} className="rotate-180" />
              </button>

              {/* Page numbers */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .reduce<(number | "…")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === "…" ? (
                    <span key={`ellipsis-${idx}`} className="h-8 w-8 flex items-center justify-center text-xs text-[#71818a]">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`h-8 w-8 flex items-center justify-center rounded-lg text-xs font-semibold border transition
                        ${currentPage === p ? "bg-[#0b1825] text-white border-[#0b1825]" : "border-[#dde4cc] text-[#71818a] hover:bg-[#f5f6ef]"}`}
                    >
                      {p}
                    </button>
                  )
                )}

              {/* Next */}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#dde4cc] text-[#71818a] hover:bg-[#f5f6ef] disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN — Admin access management
// ─────────────────────────────────────────────────────────────────
function AdminAccessManagement({ state, showToast, setState, currentEmail, session }: {
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  session: NonNullable<Session>;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  currentEmail: string;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [confirmingAdd, setConfirmingAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "team" as AdminUser["role"] });
  const [formErr, setFormErr] = useState("");

  const validateForm = () => {
    setFormErr("");
    if (!form.name.trim() || !form.email.trim()) { setFormErr("Name and email are required."); return false; }
    if (!form.email.includes("@")) { setFormErr("Invalid email."); return false; }
    const dup = state.adminUsers.find((a) => a.email.toLowerCase() === form.email.toLowerCase());
    if (dup) { setFormErr("This email is already in the admin list."); return false; }
    const isStudent = state.students.find((s) => s.email.toLowerCase() === form.email.toLowerCase());
    if (isStudent) { setFormErr("This email belongs to a student. Admin and student lists must not overlap."); return false; }
    return true;
  };

  const addAdmin = async () => {
    if (!confirmingAdd) {
      // First click: validate then show confirmation
      if (validateForm()) setConfirmingAdd(true);
      return;
    }
    // Second click: confirmed — proceed
    try {
      const res = await fetch("/api/admin-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim().toLowerCase(), role: form.role }),
      });
      const data = await res.json();
      if (!res.ok) { setFormErr(data.error ?? "Failed to add admin."); setConfirmingAdd(false); return; }
      const newAdmin: AdminUser = { id: data.id ?? `admin-${Date.now()}`, name: form.name.trim(), email: form.email.trim().toLowerCase(), role: form.role, addedAt: new Date().toISOString() };
      setState((p) => ({ ...p, adminUsers: [...p.adminUsers, newAdmin] }));
      showToast(`${form.name} added as admin. Default password: admin@sectionsync1`);
      setForm({ name: "", email: "", role: "team" });
      setShowAdd(false);
      setConfirmingAdd(false);
    } catch { setFormErr("Network error. Try again."); setConfirmingAdd(false); }
  };

  const removeAdmin = async (id: string, email: string) => {
    if (email.toLowerCase() === currentEmail.toLowerCase()) { showToast("You cannot remove your own admin access.", true); return; }
    try {
      const res = await fetch(`/api/admin-admins?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken ?? ""}` },
      });
      if (!res.ok) { showToast("Failed to remove admin. Try again.", true); return; }
      setState((p) => ({ ...p, adminUsers: p.adminUsers.filter((a) => a.id !== id) }));
      showToast("Admin removed.");
    } catch { showToast("Network error. Try again.", true); }
  };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0b1825]">Admin access management</h2>
          <p className="text-sm text-[#71818a] mt-0.5">Only emails in this list can access the admin panel.</p>
        </div>
        <Btn onClick={() => { setShowAdd(true); setFormErr(""); setForm({ name: "", email: "", role: "team" }); }}>
          <Plus size={14} /> Add admin
        </Btn>
      </div>
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
        <Shield size={14} className="mt-0.5 shrink-0" />
        No public admin registration. Admin and student lists must not overlap.
      </div>
      {showAdd && (
        <Card className="p-5">
          <h3 className="font-semibold text-[#0b1825] mb-4">Add admin / team member</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dr. Mentor" />
            <Input label="Email address" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="mentor@ncuindia.edu" />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-[#0b1825] mb-1.5">Role</label>
            <div className="flex gap-3">
              {(["primary", "team"] as const).map((r) => (
                <button key={r} onClick={() => setForm((f) => ({ ...f, role: r }))}
                  className={`flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition ${form.role === r ? "border-[#0b1825] bg-[#0b1825] text-white" : "border-[#dde4cc] hover:border-[#0b1825]/40"}`}>
                  {r === "primary" ? "Primary admin / Mentor" : "Team member"}
                </button>
              ))}
            </div>
          </div>
          {formErr && <p className="mt-2 text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle size={13} />{formErr}</p>}
          {confirmingAdd && (
            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Add <strong>{form.name}</strong> ({form.email}) as admin with default password <code className="bg-amber-100 px-1 rounded">admin@sectionsync1</code>?
            </div>
          )}
          <div className="flex gap-2 mt-4">
            {!confirmingAdd
              ? <Btn onClick={addAdmin}><Check size={14} /> Add admin</Btn>
              : <>
                  <Btn onClick={addAdmin} variant="primary"><Check size={14} /> Yes, add admin</Btn>
                  <Btn variant="secondary" onClick={() => setConfirmingAdd(false)}>Go back</Btn>
                </>
            }
            <Btn variant="secondary" onClick={() => { setShowAdd(false); setConfirmingAdd(false); }}>Cancel</Btn>
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-[#eef0e4] flex items-center justify-between">
          <h3 className="font-semibold text-[#0b1825]">Authorized admins</h3>
          <span className="text-xs text-[#71818a]">{state.adminUsers.length} total</span>
        </div>
        <div className="divide-y divide-[#f5f6ef]">
          {state.adminUsers.map((a) => {
            const isSelf = a.email.toLowerCase() === currentEmail.toLowerCase();
            return (
              <div key={a.id} className="flex items-center gap-4 px-5 py-4">
                <div className="h-9 w-9 rounded-full bg-[#0b1825] flex items-center justify-center text-white text-xs font-bold shrink-0">{initials(a.name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0b1825] flex items-center gap-2">
                    {a.name}
                    {isSelf && <span className="text-[10px] bg-[#d8ff5b] text-[#0b1825] px-1.5 py-0.5 rounded-full font-bold">You</span>}
                  </p>
                  <p className="text-xs text-[#71818a]">{a.email}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge color={a.role === "primary" ? "blue" : "default"}>{a.role === "primary" ? "Primary" : "Team"}</Badge>
                  <span className="text-[10px] text-[#71818a]">Added {fmtDate(a.addedAt)}</span>
                  <button onClick={() => removeAdmin(a.id, a.email)} disabled={isSelf}
                    className="text-[#71818a] hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition" title={isSelf ? "Cannot remove yourself" : "Remove"}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STUDENT — Dashboard
// ─────────────────────────────────────────────────────────────────
function StudentDashboard({ me, state }: { me: Student; state: AppState }) {
  const mySection = state.sections.find((s) => s.id === me.assignedSectionId);
  const specIdx   = state.specializations.findIndex((s) => s.name === me.chosenSpecialization);
  const pal       = specIdx >= 0 ? specPalette(specIdx) : null;

  const steps: { label: string; done: boolean; active: boolean }[] = [
    {
      label: "Choose your specialization",
      done:   me.chosenSpecialization !== null,
      active: state.phase === "SPEC_WINDOW_OPEN" && me.chosenSpecialization === null,
    },
    {
      label: "Wait for admin to finalize sections",
      done:   ["SECTIONS_FINALIZED", "SECTION_WINDOW_OPEN", "SECTION_WINDOW_CLOSED"].includes(state.phase),
      active: state.phase === "SPEC_WINDOW_CLOSED",
    },
    {
      label: "Pick your section & seat",
      done:   me.assignedSectionId !== null,
      active: state.phase === "SECTION_WINDOW_OPEN" && me.assignedSectionId === null,
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#0b1825]">Hello, {me.name.split(" ")[0]} 👋</h2>
        <p className="text-sm text-[#71818a] mt-1">{me.rollNumber} · 2nd Year CSE</p>
      </div>
      <PhaseBanner phase={state.phase} />
      <Card className="p-5">
        <h3 className="font-semibold text-[#0b1825] mb-4">Your progress</h3>
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm
              ${step.done ? "bg-emerald-50 border border-emerald-200" : step.active ? "bg-[#d8ff5b]/20 border border-[#d8ff5b]" : "bg-[#f9faf3] border border-[#eef0e4]"}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                ${step.done ? "bg-emerald-500 text-white" : step.active ? "bg-[#0b1825] text-[#d8ff5b]" : "bg-[#dde4cc] text-[#71818a]"}`}>
                {step.done ? <Check size={12} /> : i + 1}
              </div>
              <span className={step.done ? "text-emerald-800 font-medium" : step.active ? "text-[#0b1825] font-semibold" : "text-[#71818a]"}>{step.label}</span>
              {step.active && <ChevronRight size={14} className="ml-auto text-[#0b1825]" />}
            </div>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <p className="text-xs text-[#71818a] mb-1">Specialization</p>
          {me.chosenSpecialization && pal
            ? <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold border ${pal.badge}`}>{me.chosenSpecialization}</span>
            : <p className="text-sm text-[#71818a] italic">Not selected yet</p>}
        </Card>
        <Card className="p-5">
          <p className="text-xs text-[#71818a] mb-1">Section &amp; Seat</p>
          {mySection && me.assignedSeat
            ? <div><p className="font-bold text-[#0b1825]">{mySection.name}</p><p className="text-sm text-[#71818a]">Seat {me.assignedSeat}</p></div>
            : <p className="text-sm text-[#71818a] italic">Not assigned yet</p>}
        </Card>
        <Card className="p-5 col-span-2">
          <p className="text-xs text-[#71818a] mb-1">Group</p>
          {me.group
            ? (
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-bold border-2
                  ${me.group === 1 ? "bg-blue-100 border-blue-400 text-blue-800" : "bg-violet-100 border-violet-400 text-violet-800"}`}>
                  Group {me.group === 1 ? "G1" : "G2"}
                </span>
                <p className="text-xs text-[#71818a]">Assigned after section window closed</p>
              </div>
            )
            : <p className="text-sm text-[#71818a] italic">Assigned when the section window closes</p>}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STUDENT — Specialization selection
// ─────────────────────────────────────────────────────────────────
function StudentSpecSelection({ me, state, showToast, setState, session }: {
  me: Student; state: AppState;
  showToast: (m: string, err?: boolean) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  session: NonNullable<Session>;
}) {
  const isOpen      = state.phase === "SPEC_WINDOW_OPEN";
  const activeSpecs = state.specializations.filter((s) => s.active);
  // pending = what the student has clicked but not yet confirmed
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);

  // The confirmed selection (from DB, persists across sessions)
  const confirmed = me.chosenSpecialization;
  // What to highlight: pending takes priority, falls back to confirmed
  const displayed = pending ?? confirmed;

  const confirmSelection = async () => {
    if (!pending) return;
    const spec = state.specializations.find((s) => s.name === pending);
    if (!spec) return;
    setSaving(true);
    try {
      const res = await fetch("/api/student-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ specialization_id: spec.id }),
      });
      if (!res.ok) {
        const d = await res.json();
        showToast(d.error ?? "Failed to save. Try again.", true);
        return;
      }
      // Update local state so admin panel and dashboard reflect immediately
      setState((p) => ({ ...p, students: p.students.map((s) => s.id === me.id ? { ...s, chosenSpecialization: pending } : s) }));
      showToast(`Specialization confirmed: ${pending}`);
      setPending(null);
    } catch {
      showToast("Network error. Try again.", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="font-display text-xl font-bold text-[#0b1825]">Choose your specialization</h2>
        <p className="text-sm text-[#71818a] mt-1">
          {isOpen
            ? confirmed ? "Your selection is saved. You can change it while the window is open." : "Select a specialization and confirm your choice."
            : "The specialization selection window is currently closed."}
        </p>
      </div>
      {!isOpen && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <Lock size={14} /> Window closed. Contact your admin if changes are needed.
        </div>
      )}
      {confirmed && !pending && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={14} /> Your selection <strong>{confirmed}</strong> is confirmed and saved.
        </div>
      )}
      {activeSpecs.length === 0 && isOpen && (
        <div className="rounded-xl bg-[#f9faf3] border border-[#eef0e4] p-8 text-center text-sm text-[#71818a]">
          No specializations are available yet. Your admin will add them soon.
        </div>
      )}
      <div className="grid gap-3">
        {activeSpecs.map((spec, i) => {
          const isDisplayed = displayed === spec.name;
          const isConfirmed = confirmed === spec.name;
          const pal = specPalette(i);
          return (
            <button key={spec.id} onClick={() => { if (isOpen) setPending(spec.name); }} disabled={!isOpen}
              className={`w-full text-left rounded-2xl border-2 p-5 transition
                ${isDisplayed ? "border-[#0b1825] bg-[#0b1825] text-white" : "border-[#dde4cc] bg-white hover:border-[#0b1825]/40 hover:bg-[#f9faf3]"}
                disabled:opacity-60 disabled:cursor-not-allowed`}>
              <div className="flex items-center gap-3 mb-1.5">
                <div className={`h-3 w-3 rounded-full ${isDisplayed ? "bg-[#d8ff5b]" : pal.dot}`} />
                <span className={`font-bold text-base ${isDisplayed ? "text-white" : "text-[#0b1825]"}`}>{spec.name}</span>
                <Badge color="default">{spec.batch}</Badge>
                {isConfirmed && !pending && <span className="ml-auto flex items-center gap-1 text-xs font-bold text-[#d8ff5b]"><Check size={12} /> Confirmed</span>}
                {isDisplayed && pending && <span className="ml-auto flex items-center gap-1 text-xs font-bold text-[#d8ff5b]"><Check size={12} /> Selected</span>}
              </div>
              {spec.description && (
                <p className={`text-sm ml-6 ${isDisplayed ? "text-white/70" : "text-[#71818a]"}`}>{spec.description}</p>
              )}
            </button>
          );
        })}
      </div>
      {isOpen && pending && (
        <div className="flex gap-3 items-center pt-1">
          <Btn onClick={confirmSelection} disabled={saving} variant="lime">
            {saving ? "Saving…" : <><Check size={14} /> Confirm selection</>}
          </Btn>
          <Btn variant="secondary" onClick={() => setPending(null)} disabled={saving}>Cancel</Btn>
          <span className="text-xs text-[#71818a]">Your choice won't be saved until you confirm.</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STUDENT — Section + Seat selection
// ─────────────────────────────────────────────────────────────────
function StudentSectionSeat({ me, state, showToast, setState, session }: {
  me: Student; state: AppState;
  showToast: (m: string, err?: boolean) => void;
  session: NonNullable<Session>;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(me.assignedSectionId);
  const [hoveredSeat, setHoveredSeat] = useState<number | null>(null);
  const isOpen = state.phase === "SECTION_WINDOW_OPEN";

  if (!me.chosenSpecialization) {
    return (
      <Card className="p-10 text-center max-w-lg">
        <AlertTriangle size={28} className="text-amber-400 mx-auto mb-3" />
        <p className="text-sm text-[#71818a]">You haven't selected a specialization yet. Do that first.</p>
      </Card>
    );
  }

  const availableSections = state.sections.filter((s) => s.specializationName === me.chosenSpecialization);

  if (availableSections.length === 0) {
    return (
      <Card className="p-10 text-center max-w-lg">
        <Clock size={28} className="text-[#dde4cc] mx-auto mb-3" />
        <p className="font-semibold text-[#0b1825] mb-1">Sections not ready yet</p>
        <p className="text-sm text-[#71818a]">The admin hasn't finalized sections yet. Check back soon.</p>
      </Card>
    );
  }

  if (!isOpen && me.assignedSectionId === null) {
    return (
      <Card className="p-10 text-center max-w-lg">
        <Lock size={28} className="text-[#dde4cc] mx-auto mb-3" />
        <p className="font-semibold text-[#0b1825] mb-1">Section selection is not open yet</p>
        <p className="text-sm text-[#71818a]">The admin will open the section-selection window soon.</p>
      </Card>
    );
  }

  const preview = selectedSectionId
    ? (availableSections.find((s) => s.id === selectedSectionId) ?? availableSections[0])
    : availableSections[0];
  const taken      = takenSeats(preview, state.students);
  const studentsIn = state.students.filter((s) => s.assignedSectionId === preview.id);

  const confirmSeat = async (seat: number) => {
    if (!isOpen) { showToast("Section selection is closed.", true); return; }
    if (taken.includes(seat) && !(me.assignedSectionId === preview.id && me.assignedSeat === seat)) {
      showToast("That seat is already taken.", true); return;
    }
    try {
      const res = await fetch("/api/book-seat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken ?? ""}` },
        body: JSON.stringify({ section_id: preview.id, seat_number: seat }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? "Booking failed. Try again.", true); return; }
      // Update local state so dashboard reflects immediately
      setState((p) => ({
        ...p, students: p.students.map((s) => s.id === me.id ? { ...s, assignedSectionId: preview.id, assignedSeat: seat } : s),
      }));
      showToast(`Seat ${seat} in ${preview.name} confirmed!`);
    } catch { showToast("Network error. Try again.", true); }
  };

  const COLS = 10;
  const rows = Math.ceil(preview.capacity / COLS);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="font-display text-xl font-bold text-[#0b1825]">Choose your section &amp; seat</h2>
        <p className="text-sm text-[#71818a] mt-1">{isOpen ? "Pick a section, then click a seat to claim it." : "Your current selection is shown below."}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {availableSections.map((sec) => {
          const cnt = takenSeats(sec, state.students).length;
          const pct = Math.round((cnt / sec.capacity) * 100);
          const isSel = preview.id === sec.id;
          return (
            <button key={sec.id} onClick={() => setSelectedSectionId(sec.id)}
              className={`rounded-2xl border-2 px-5 py-3 text-left transition ${isSel ? "border-[#0b1825] bg-[#0b1825] text-white" : "border-[#dde4cc] bg-white hover:border-[#0b1825]/40"}`}>
              <p className={`font-bold text-sm ${isSel ? "text-white" : "text-[#0b1825]"}`}>{sec.name}</p>
              <p className={`text-xs mt-0.5 ${isSel ? "text-white/60" : "text-[#71818a]"}`}>{cnt}/{sec.capacity} seats · {pct}% full</p>
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-[1fr_260px] gap-5">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-[#0b1825]">{preview.name} — Seat map</h3>
            <div className="flex items-center gap-4 text-xs text-[#71818a]">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#f0f2e4] border border-[#dde4cc]" />Available</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#d8ff5b]" />Yours</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#0b1825]" />Taken</span>
            </div>
          </div>
          <div className="mb-6 flex flex-col items-center">
            <div className="w-3/4 h-2 rounded-full bg-gradient-to-r from-transparent via-[#dde4cc] to-transparent" />
            <p className="text-[10px] text-[#71818a] mt-1 tracking-widest uppercase">Whiteboard / Screen</p>
          </div>
          <div className="space-y-2">
            {Array.from({ length: rows }, (_, rowIdx) => (
              <div key={rowIdx} className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#71818a] w-4 text-right shrink-0">{String.fromCharCode(65 + rowIdx)}</span>
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: COLS }, (_, colIdx) => {
                    const seat = rowIdx * COLS + colIdx + 1;
                    if (seat > preview.capacity) return null;
                    const isMine   = me.assignedSectionId === preview.id && me.assignedSeat === seat;
                    const isTaken  = taken.includes(seat) && !isMine;
                    const isHov    = hoveredSeat === seat;
                    return (
                      <button key={seat}
                        onClick={() => confirmSeat(seat)}
                        onMouseEnter={() => setHoveredSeat(seat)}
                        onMouseLeave={() => setHoveredSeat(null)}
                        disabled={isTaken || (!isOpen && !isMine)}
                        title={isTaken ? "Taken" : isMine ? `Your seat (${seat})` : `Seat ${seat}`}
                        className={`h-8 w-8 rounded-lg text-[10px] font-bold border transition
                          ${isMine   ? "bg-[#d8ff5b] border-[#b8df3b] text-[#0b1825]"
                          : isTaken  ? "bg-[#0b1825] border-[#0b1825] text-[#3a5060] cursor-not-allowed"
                          : isHov    ? "bg-[#0b1825] border-[#0b1825] text-white"
                          :            "bg-[#f0f2e4] border-[#dde4cc] text-[#71818a] hover:border-[#0b1825]"}`}>
                        {seat}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {hoveredSeat && (
            <p className="text-xs text-[#71818a] mt-4 text-center">
              {taken.includes(hoveredSeat) && !(me.assignedSectionId === preview.id && me.assignedSeat === hoveredSeat)
                ? `Seat ${hoveredSeat} is already taken`
                : me.assignedSectionId === preview.id && me.assignedSeat === hoveredSeat
                  ? `Seat ${hoveredSeat} — your current seat`
                  : `Click to take seat ${hoveredSeat}`}
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-[#0b1825] mb-3">
            Students in {preview.name}
            <span className="text-xs text-[#71818a] font-normal ml-2">({studentsIn.length})</span>
          </h3>
          {studentsIn.length === 0
            ? <p className="text-sm text-[#71818a]">No one here yet.</p>
            : (
              <div className="space-y-2 overflow-y-auto max-h-[420px] pr-1">
                {studentsIn.sort((a, b) => (a.assignedSeat ?? 0) - (b.assignedSeat ?? 0)).map((s) => (
                  <div key={s.id} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${s.id === me.id ? "bg-[#d8ff5b]/20 border border-[#d8ff5b]" : "bg-[#f9faf3]"}`}>
                    <div className="h-7 w-7 rounded-full bg-[#e8ead8] flex items-center justify-center text-[10px] font-bold text-[#0b1825] shrink-0">{initials(s.name)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#0b1825] truncate">{s.name}{s.id === me.id ? " (you)" : ""}</p>
                      <p className="text-[10px] text-[#71818a]">{s.rollNumber}</p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-[10px] font-bold text-[#71818a]">S{s.assignedSeat}</span>
                      {s.group && (
                        <span className={`text-[9px] font-bold px-1 rounded ${s.group === 1 ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"}`}>G{s.group}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// STUDENT — Swap Requests
// ─────────────────────────────────────────────────────────────────
function StudentSwapRequests({ me, state, showToast, setState }: {
  me: Student;
  state: AppState;
  showToast: (m: string, err?: boolean) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"sent" | "received">("sent");

  const isOpen = state.phase === "SECTION_WINDOW_OPEN";
  const mySection = state.sections.find((s) => s.id === me.assignedSectionId);

  const sent     = state.swapRequests.filter((r) => r.requesterId === me.id);
  const received = state.swapRequests.filter((r) => r.targetId === me.id && r.status === "PENDING");

  const hasPending = sent.some((r) => r.status === "PENDING");

  const sendRequest = (e: FormEvent) => {
    e.preventDefault();
    if (!isOpen) { showToast("Section window is closed. Swaps are not allowed.", true); return; }
    if (!me.assignedSectionId) { showToast("You haven't selected a section yet.", true); return; }
    if (!targetId) { showToast("Select a student to swap with.", true); return; }
    if (hasPending) { showToast("You already have a pending swap request.", true); return; }
    const target = state.students.find((s) => s.id === targetId);
    if (!target) { showToast("Student not found.", true); return; }
    if (!target.assignedSectionId) { showToast("That student hasn't selected a section yet.", true); return; }
    if (target.assignedSectionId === me.assignedSectionId) { showToast("You're already in the same section.", true); return; }
    if (target.chosenSpecialization !== me.chosenSpecialization) {
      showToast("You can only swap with students in the same specialization.", true); return;
    }

    const req: SwapRequest = {
      id: `swap-${Date.now()}`,
      requesterId: me.id,
      targetId,
      requesterSectionId: me.assignedSectionId,
      targetSectionId: target.assignedSectionId,
      status: "PENDING",
      note: note.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    setState((p) => ({ ...p, swapRequests: [req, ...p.swapRequests] }));
    setTargetId(""); setNote("");
    showToast("Swap request sent.");
  };

  const acceptSwap = (req: SwapRequest) => {
    if (!isOpen) { showToast("Section window is closed.", true); return; }
    const requester = state.students.find((s) => s.id === req.requesterId);
    if (!requester || !requester.assignedSectionId || !me.assignedSectionId) {
      showToast("Cannot complete swap — one of you hasn't selected a section.", true); return;
    }
    // Swap sections and seats atomically in local state
    setState((p) => ({
      ...p,
      students: p.students.map((s) => {
        if (s.id === me.id) return { ...s, assignedSectionId: requester.assignedSectionId, assignedSeat: requester.assignedSeat };
        if (s.id === requester.id) return { ...s, assignedSectionId: me.assignedSectionId!, assignedSeat: me.assignedSeat };
        return s;
      }),
      swapRequests: p.swapRequests.map((r) =>
        r.id === req.id ? { ...r, status: "ACCEPTED" as SwapStatus, resolvedAt: new Date().toISOString() } : r
      ),
    }));
    showToast("Swap completed! Your sections have been exchanged.");
  };

  const rejectSwap = (req: SwapRequest) => {
    setState((p) => ({
      ...p,
      swapRequests: p.swapRequests.map((r) =>
        r.id === req.id ? { ...r, status: "REJECTED" as SwapStatus, resolvedAt: new Date().toISOString() } : r
      ),
    }));
    showToast("Swap request declined.");
  };

  const cancelSwap = (req: SwapRequest) => {
    setState((p) => ({
      ...p,
      swapRequests: p.swapRequests.map((r) =>
        r.id === req.id ? { ...r, status: "CANCELLED" as SwapStatus, resolvedAt: new Date().toISOString() } : r
      ),
    }));
    showToast("Swap request cancelled.");
  };

  const statusBadge = (s: SwapStatus) => {
    const map: Record<SwapStatus, { color: "green" | "red" | "yellow" | "default"; label: string }> = {
      PENDING:   { color: "yellow",  label: "Pending" },
      ACCEPTED:  { color: "green",   label: "Accepted" },
      REJECTED:  { color: "red",     label: "Declined" },
      CANCELLED: { color: "default", label: "Cancelled" },
    };
    const { color, label } = map[s];
    return <Badge color={color}>{label}</Badge>;
  };

  // Students eligible to swap with: same spec, different section, has a seat
  const eligibleTargets = state.students.filter(
    (s) => s.id !== me.id
      && s.chosenSpecialization === me.chosenSpecialization
      && s.assignedSectionId
      && s.assignedSectionId !== me.assignedSectionId
  );

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="font-display text-xl font-bold text-[#0b1825]">Swap requests</h2>
        <p className="text-sm text-[#71818a] mt-1">
          Request to swap your section with another student in the same specialization.
          Both must agree. Only available while the section window is open.
        </p>
      </div>

      {!isOpen && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <Lock size={14} /> The section window is closed. No new swaps can be initiated.
        </div>
      )}

      {/* Current section */}
      {mySection && (
        <div className="rounded-xl bg-[#f9faf3] border border-[#eef0e4] px-4 py-3 text-sm flex items-center justify-between">
          <span className="text-[#71818a]">Your current section</span>
          <span className="font-bold text-[#0b1825]">{mySection.name} · {me.chosenSpecialization}</span>
        </div>
      )}

      {/* Send request */}
      {isOpen && me.assignedSectionId && !hasPending && (
        <Card className="p-5">
          <h3 className="font-semibold text-[#0b1825] mb-4">Send swap request</h3>
          <form onSubmit={sendRequest} className="space-y-3">
            <div>
              <label className="block text-xs text-[#71818a] mb-1">Student to swap with</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                className="w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-3 py-2.5 text-sm outline-none focus:border-[#0b1825]">
                <option value="">Select a student…</option>
                {eligibleTargets.map((s) => {
                  const sec = state.sections.find((sc) => sc.id === s.assignedSectionId);
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} — {sec?.name ?? "unknown section"}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#71818a] mb-1">Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Why do you want to swap?"
                className="w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-3 py-2.5 text-sm outline-none focus:border-[#0b1825]" />
            </div>
            <Btn type="submit" disabled={!targetId}><ArrowLeftRight size={14} /> Send swap request</Btn>
          </form>
        </Card>
      )}

      {hasPending && isOpen && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          You have a pending outgoing swap request. Cancel it before sending a new one.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 border-b border-[#dde4cc]">
        {(["sent", "received"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 transition ${tab === t ? "border-[#0b1825] text-[#0b1825]" : "border-transparent text-[#71818a]"}`}>
            {t === "sent" ? `Sent (${sent.length})` : `Incoming (${received.length})`}
          </button>
        ))}
      </div>

      {tab === "sent" && (
        <div className="space-y-2">
          {sent.length === 0 && <p className="text-sm text-[#71818a]">No requests sent yet.</p>}
          {sent.map((req) => {
            const target = state.students.find((s) => s.id === req.targetId);
            const targetSec = state.sections.find((s) => s.id === req.targetSectionId);
            return (
              <Card key={req.id} className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0b1825]">{target?.name ?? "Unknown"}</p>
                  <p className="text-xs text-[#71818a]">Their section: {targetSec?.name ?? "—"}</p>
                  {req.note && <p className="text-xs text-[#71818a] italic mt-0.5">"{req.note}"</p>}
                </div>
                {statusBadge(req.status)}
                {req.status === "PENDING" && isOpen && (
                  <button onClick={() => cancelSwap(req)}
                    className="text-xs text-[#71818a] hover:text-red-600 underline transition">Cancel</button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === "received" && (
        <div className="space-y-2">
          {received.length === 0 && <p className="text-sm text-[#71818a]">No incoming requests.</p>}
          {received.map((req) => {
            const requester = state.students.find((s) => s.id === req.requesterId);
            const reqSec = state.sections.find((s) => s.id === req.requesterSectionId);
            return (
              <Card key={req.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0b1825]">{requester?.name ?? "Unknown"}</p>
                    <p className="text-xs text-[#71818a]">Their section: {reqSec?.name ?? "—"}</p>
                    {req.note && <p className="text-xs text-[#71818a] italic mt-0.5">"{req.note}"</p>}
                  </div>
                  <Badge color="yellow">Pending</Badge>
                </div>
                <div className="flex gap-2">
                  <Btn onClick={() => acceptSwap(req)} className="flex-1">Accept swap</Btn>
                  <Btn variant="secondary" onClick={() => rejectSwap(req)} className="flex-1">Decline</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// CHANGE PASSWORD — shared for student and admin
// ─────────────────────────────────────────────────────────────────
function ChangePasswordPage({ session, showToast }: {
  session: NonNullable<Session>;
  showToast: (m: string, err?: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!current || !newPass || !confirm) { setError("All fields are required."); return; }
    if (newPass.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (newPass !== confirm) { setError("Passwords do not match."); return; }

    setLoading(true);
    const result = await changePassword(newPass);
    setLoading(false);

    if (result.ok) {
      showToast("Password updated successfully.");
      setCurrent(""); setNewPass(""); setConfirm("");
    } else {
      setError(result.error ?? "Failed to update password.");
    }
  };

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold text-[#0b1825]">Change password</h2>
        <p className="text-sm text-[#71818a] mt-1">Update your account password.</p>
      </div>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#0b1825] mb-1.5">Current password</label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
              placeholder="Your current password"
              className="w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-4 py-2.5 text-sm outline-none focus:border-[#0b1825] focus:ring-2 focus:ring-[#0b1825]/10 transition" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0b1825] mb-1.5">New password</label>
            <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-4 py-2.5 text-sm outline-none focus:border-[#0b1825] focus:ring-2 focus:ring-[#0b1825]/10 transition" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#0b1825] mb-1.5">Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              className="w-full rounded-xl border border-[#dde4cc] bg-[#f9faf3] px-4 py-2.5 text-sm outline-none focus:border-[#0b1825] focus:ring-2 focus:ring-[#0b1825]/10 transition" />
          </div>
          {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle size={13} />{error}</p>}
          <Btn type="submit" disabled={loading} className="w-full">
            <KeyRound size={14} /> {loading ? "Updating…" : "Update password"}
          </Btn>
        </form>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────
export default function Index() {
  const [session, setSession]       = useState<Session>(null);
  const [sessionChecked, setSessionChecked] = useState(false); // true once we know if a session exists
  const [state, setState]           = useState<AppState>(() => createInitialData());
  const [adminPage, setAdminPage]   = useState<AdminPage>("dashboard");
  const [studentPage, setStudentPage] = useState<StudentPage>("dashboard");
  const [toast, setToast]           = useState<Toast>(null);

  // Load all data from Supabase on startup
  useEffect(() => {
    (async () => {
      // Load specializations, config, and sections in parallel FIRST so they're
      // all available before session restore — prevents race conditions
      const [specsRes, configRes, sectionsRes] = await Promise.all([
        supabase.from("specializations").select("*").order("name"),
        supabase.from("system_config").select("*").eq("id", 1).single(),
        supabase.from("sections")
          .select("id, name, capacity, specialization_id, specialization:specialization_id(id,name,batch)")
          .order("name"),
      ]);

      if (specsRes.data && specsRes.data.length > 0) {
        const specs: SpecializationDef[] = specsRes.data.map((s: any) => ({
          id:          s.id,
          name:        s.name,
          batch:       s.batch ?? "2024-25",
          active:      s.active ?? true,
          description: s.description ?? undefined,
          createdAt:   s.created_at,
        }));
        setState((p) => ({ ...p, specializations: specs }));
      }

      if (configRes.data) {
        const d = configRes.data;
        setState((p) => ({
          ...p,
          phase:                d.phase,
          specWindowStatus:     d.spec_window_open ? "OPEN" : "CLOSED",
          sectionWindowStatus:  d.section_window_open ? "OPEN" : "CLOSED",
          sectionWindowDeadline: d.section_window_deadline ?? null,
        }));
      }

      // Load sections from the parallel result
      if (sectionsRes.data && sectionsRes.data.length > 0) {
        const sections = sectionsRes.data.map((s: any) => ({
          id: s.id, name: s.name, capacity: s.capacity,
          specializationId: s.specialization_id,
          specializationName: s.specialization?.name ?? "",
          occupancy: 0,
        }));
        setState((p) => ({ ...p, sections }));
      }

      // Now check for a persisted session — all data is loaded so
      // handleLogin can resolve chosen_specialization_id UUID to name correctly
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      // Build the fresh specs list from what we just loaded (not from stale state closure)
      const freshSpecs: SpecializationDef[] = specsRes.data?.map((s: any) => ({
        id: s.id, name: s.name, batch: s.batch ?? "2024-25",
        active: s.active ?? true, description: s.description ?? undefined, createdAt: s.created_at,
      })) ?? [];

      if (sbSession && !session) {
        const em = sbSession.user.email?.toLowerCase() ?? "";
        const tok = sbSession.access_token;
        try {
          const r = await fetch("/api/admin-admins", {
            headers: { Authorization: `Bearer ${tok}` },
          });
          if (r.ok) {
            setSession({ role: "admin", email: em, accessToken: tok });
            // Pre-load student list so admin dashboard doesn't flash empty
            fetch("/api/admin-students", { headers: { Authorization: `Bearer ${tok}` } })
              .then((r) => r.ok ? r.json() : null)
              .then((d) => {
                if (d?.data) {
                  setState((p) => ({
                    ...p,
                    students: d.data.map((s: any) => ({
                      id: s.id, rollNumber: s.roll_number, name: s.name, email: s.email,
                      chosenSpecialization: s.chosen_specialization_id
                        ? (freshSpecs.find((sp) => sp.id === s.chosen_specialization_id)?.name ?? null)
                        : null,
                      assignedSectionId: s.assigned_section_id ?? null,
                      assignedSeat: s.assigned_seat ?? null,
                      group: s.group_number ?? null,
                    })),
                  }));
                }
              }).catch(() => {});
          } else {
            // Not an admin — check if they're a student before restoring
            // This blocks deleted admins from getting a blank student dashboard
            const studentCheck = await fetch("/api/sign-in", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // We only need to verify they're in the students table, not re-auth
              // Use a lightweight check: query student existence via the token
            }).catch(() => null);
            // Simpler: just call handleLogin — it queries students table via RLS
            // If student row doesn't exist, handleLogin falls through to setSession(s)
            // which would give a blank student view. Fix: check if student exists first.
            const userClient = createClient(
              import.meta.env.VITE_SUPABASE_URL as string,
              import.meta.env.VITE_SUPABASE_ANON_KEY as string,
              { global: { headers: { Authorization: `Bearer ${tok}` } } }
            );
            const { data: studentRow } = await userClient
              .from("students").select("id").eq("email", em).maybeSingle();
            if (studentRow) {
              await handleLogin({ role: "student", email: em, accessToken: tok }, freshSpecs);
            }
            // else: not admin, not student — deleted user, stay logged out
          }
        } catch {
          // Network error on restore — stay logged out
        }
      }
      setSessionChecked(true);
    })();
  }, []);

  const showToast = (message: string, error = false) => {
    setToast({ message, error });
    setTimeout(() => setToast(null), 3500);
  };

  // specsOverride: pass freshly loaded specs when calling from startup to avoid stale closure
  const handleLogin = async (s: NonNullable<Session>, specsOverride?: SpecializationDef[]) => {
    if (s.role === "student") {
      try {
        const userClient = createClient(
          import.meta.env.VITE_SUPABASE_URL as string,
          import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          { global: { headers: { Authorization: `Bearer ${s.accessToken}` } } }
        );
        const { data } = await userClient
          .from("students")
          .select("id, roll_number, name, email, year, chosen_specialization_id, assigned_section_id, assigned_seat, group_number")
          .eq("email", s.email.toLowerCase())
          .maybeSingle();
        if (data) {
          // Use specsOverride if provided — avoids stale closure when called from startup
          const specs = specsOverride ?? state.specializations;
          const chosenSpec = data.chosen_specialization_id
            ? (specs.find((sp) => sp.id === data.chosen_specialization_id)?.name ?? null)
            : null;
          const student: Student = {
            id:                   data.id,
            rollNumber:           data.roll_number,
            name:                 data.name,
            email:                data.email,
            chosenSpecialization: chosenSpec,
            assignedSectionId:    data.assigned_section_id ?? null,
            assignedSeat:         data.assigned_seat ?? null,
            group:                data.group_number ?? null,
          };
          setState((p) => ({ ...p, students: [student] }));
          setSession({ ...s, studentId: data.id });
          // Load sections with the student's own token so RLS allows the read
          void (async () => {
            try {
              const { data: secData } = await userClient.from("sections")
                .select("id, name, capacity, specialization_id, specialization:specialization_id(id,name,batch)")
                .order("name");
              if (secData && secData.length > 0) {
                const sections = secData.map((sec: any) => ({
                  id: sec.id, name: sec.name, capacity: sec.capacity,
                  specializationId: sec.specialization_id,
                  specializationName: sec.specialization?.name ?? "",
                  occupancy: 0,
                }));
                setState((p) => ({ ...p, sections }));
              }
            } catch { /* ignore */ }
          })();
          return;
        }
      } catch { /* fall through */ }
    }
    setSession(s);
  };

  if (!sessionChecked) return (
    <div className="min-h-screen bg-[#f5f6ef] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#0b1825] flex items-center justify-center animate-pulse">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d8ff5b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l2 2 4-4"/></svg>
        </div>
        <p className="text-sm text-[#71818a]">Loading…</p>
      </div>
    </div>
  );
  if (!session) return <LoginScreen state={state} onLogin={handleLogin} />;

  const isAdmin = session.role === "admin";
  const liveMe  = session.studentId ? state.students.find((s) => s.id === session.studentId) ?? null : null;

  return (
    <>
      <AppShell
        session={session}
        state={state}
        adminPage={adminPage}
        studentPage={studentPage}
        setAdminPage={setAdminPage}
        setStudentPage={setStudentPage}
        onLogout={() => {
          supabase.auth.signOut(); // clear persisted session from localStorage
          setSession(null);
          setAdminPage("dashboard");
          setStudentPage("dashboard");
        }}
      >
        {isAdmin && (
          <>
            {adminPage === "dashboard"       && <AdminDashboard state={state} />}
            {adminPage === "specializations" && <AdminSpecializations state={state} showToast={showToast} setState={setState} token={session.accessToken ?? ""} />}
            {adminPage === "spec-window"     && <AdminSpecWindow state={state} showToast={showToast} setState={setState} session={session} />}
            {adminPage === "sections"        && <AdminSections state={state} showToast={showToast} setState={setState} session={session} />}
            {adminPage === "section-window"  && <AdminSectionWindow state={state} showToast={showToast} setState={setState} session={session} />}
            {adminPage === "students"        && <AdminStudents state={state} />}
            {adminPage === "student-list"    && <AdminStudentList state={state} showToast={showToast} setState={setState} session={session} />}
            {adminPage === "admin-access"    && <AdminAccessManagement state={state} showToast={showToast} setState={setState} currentEmail={session.email} session={session} />}
            {adminPage === "change-password" && <ChangePasswordPage session={session} showToast={showToast} />}
          </>
        )}
        {!isAdmin && liveMe && (
          <>
            {studentPage === "dashboard"      && <StudentDashboard me={liveMe} state={state} />}
            {studentPage === "spec-selection" && <StudentSpecSelection me={liveMe} state={state} showToast={showToast} setState={setState} session={session} />}
            {studentPage === "section-seat"   && <StudentSectionSeat me={liveMe} state={state} showToast={showToast} setState={setState} session={session} />}
            {studentPage === "swaps"          && <StudentSwapRequests me={liveMe} state={state} showToast={showToast} setState={setState} />}
            {studentPage === "change-password" && <ChangePasswordPage session={session} showToast={showToast} />}
          </>
        )}
      </AppShell>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-xl
          ${toast.error ? "bg-red-600 text-white" : "bg-[#0b1825] text-white"}`}>
          {toast.error ? <AlertTriangle size={15} /> : <Check size={15} />}
          {toast.message}
        </div>
      )}
    </>
  );
}
