/**
 * React Query hooks for all SectionSync data.
 *
 * READ operations use the anon Supabase client (RLS enforced).
 * WRITE operations that require admin go through the /api/* routes
 * so admin verification happens server-side.
 * Seat booking goes through /api/book-seat for atomic transaction.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DBSection, DBSpecialization, DBStudent, DBSeat, DBSystemConfig, DBAdmin } from "@/lib/database.types";

// ── Query keys ────────────────────────────────────────────────────
export const QK = {
  config:          ["system-config"]   as const,
  specializations: ["specializations"] as const,
  sections:        ["sections"]        as const,
  students:        ["students"]        as const,
  myStudent:       ["my-student"]      as const,
  seats:   (sectionId: string) => ["seats", sectionId] as const,
  admins:          ["admins"]          as const,
};

// ── Helpers ───────────────────────────────────────────────────────
async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function apiFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

// ─────────────────────────────────────────────────────────────────
// READ HOOKS
// ─────────────────────────────────────────────────────────────────

/** System phase and window state */
export function useSystemConfig() {
  return useQuery({
    queryKey: QK.config,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_config")
        .select("*")
        .eq("id", 1)
        .single();
      if (error) throw error;
      return data as DBSystemConfig;
    },
    refetchInterval: 30_000, // poll every 30 s so phase changes appear
  });
}

/** All specializations (admin sees all, student sees active only) */
export function useSpecializations(adminMode = false) {
  return useQuery({
    queryKey: [...QK.specializations, adminMode],
    queryFn: async () => {
      let q = supabase.from("specializations").select("*").order("name");
      if (!adminMode) q = q.eq("active", true) as typeof q;
      const { data, error } = await q;
      if (error) throw error;
      return data as DBSpecialization[];
    },
  });
}

/** All sections with specialization info + seat counts */
export function useSections() {
  return useQuery({
    queryKey: QK.sections,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sections")
        .select(`
          id, name, capacity, specialization_id, created_at,
          specialization:specialization_id ( id, name, batch ),
          seats ( id, seat_number, student_id )
        `)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        ...s,
        occupancy: (s.seats ?? []).filter((seat: any) => seat.student_id !== null).length,
      })) as DBSection[];
    },
  });
}

/** Seats for a specific section with student names */
export function useSectionSeats(sectionId: string | null) {
  return useQuery({
    queryKey: sectionId ? QK.seats(sectionId) : ["seats-disabled"],
    enabled: !!sectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seats")
        .select(`
          id, seat_number, student_id, booked_at,
          student:student_id ( id, name, roll_number )
        `)
        .eq("section_id", sectionId!)
        .order("seat_number");
      if (error) throw error;
      return data as unknown as DBSeat[];
    },
    refetchInterval: 5_000, // refresh every 5 s during seat selection
  });
}

/** The current authenticated student's own record */
export function useMyStudent() {
  return useQuery({
    queryKey: QK.myStudent,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("students")
        .select(`
          id, roll_number, name, email, year, assigned_seat,
          chosen_specialization_id, assigned_section_id,
          specialization:chosen_specialization_id ( id, name, batch ),
          section:assigned_section_id ( id, name, capacity )
        `)
        .eq("auth_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DBStudent | null;
    },
  });
}

/** All students (admin only — filtered by RLS on the server) */
export function useStudents() {
  return useQuery({
    queryKey: QK.students,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select(`
          id, roll_number, name, email, year, assigned_seat,
          chosen_specialization_id, assigned_section_id,
          specialization:chosen_specialization_id ( id, name ),
          section:assigned_section_id ( id, name )
        `)
        .order("roll_number");
      if (error) throw error;
      return data as unknown as DBStudent[];
    },
  });
}

/** Authorized admins list */
export function useAdmins() {
  return useQuery({
    queryKey: QK.admins,
    queryFn: async () => {
      const json = await apiFetch("/api/admin-admins");
      return json.data as DBAdmin[];
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// STUDENT MUTATIONS
// ─────────────────────────────────────────────────────────────────

/** Student picks a specialization (direct Supabase update — RLS guards fields) */
export function useChooseSpecialization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ studentId, specId }: { studentId: string; specId: string }) => {
      const { error } = await supabase
        .from("students")
        .update({ chosen_specialization_id: specId })
        .eq("id", studentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.myStudent });
      qc.invalidateQueries({ queryKey: QK.students });
    },
  });
}

/** Atomic seat booking — goes through /api/book-seat */
export function useBookSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sectionId, seatNumber }: { sectionId: string; seatNumber: number }) => {
      await apiFetch("/api/book-seat", {
        method: "POST",
        body: JSON.stringify({ section_id: sectionId, seat_number: seatNumber }),
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: QK.myStudent });
      qc.invalidateQueries({ queryKey: QK.seats(vars.sectionId) });
      qc.invalidateQueries({ queryKey: QK.sections });
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// ADMIN MUTATIONS
// ─────────────────────────────────────────────────────────────────

/** Upload / bulk import students */
export function useAdminBulkImportStudents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (students: { name: string; roll_number: string; email: string; year?: number }[]) => {
      await apiFetch("/api/admin-students/bulk", {
        method: "POST",
        body: JSON.stringify({ students }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.students }),
  });
}

export function useAdminAddStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (student: { name: string; roll_number: string; email: string; year?: number }) => {
      await apiFetch("/api/admin-students", { method: "POST", body: JSON.stringify(student) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.students }),
  });
}

export function useAdminUpdateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; name?: string; roll_number?: string; year?: number }) => {
      await apiFetch("/api/admin-students", { method: "PUT", body: JSON.stringify({ id, ...fields }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.students }),
  });
}

export function useAdminDeleteStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/admin-students?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.students }),
  });
}

/** Specialization CRUD */
export function useAdminAddSpecialization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (spec: { name: string; batch: string; description?: string; active?: boolean }) => {
      await apiFetch("/api/admin-specializations", { method: "POST", body: JSON.stringify(spec) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.specializations }),
  });
}

export function useAdminUpdateSpecialization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; name?: string; batch?: string; description?: string; active?: boolean }) => {
      await apiFetch("/api/admin-specializations", { method: "PUT", body: JSON.stringify({ id, ...fields }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.specializations }),
  });
}

export function useAdminDeleteSpecialization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/admin-specializations?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.specializations }),
  });
}

/** System config / phase updates */
export function useAdminUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<{ phase: string; spec_window_open: boolean; section_window_open: boolean; section_window_deadline: string | null }>) => {
      await apiFetch("/api/admin-config", { method: "PUT", body: JSON.stringify(updates) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.config }),
  });
}

export function useAdminCreateSections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await apiFetch("/api/admin-config", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.sections });
      qc.invalidateQueries({ queryKey: QK.config });
    },
  });
}

/** Section capacity update */
export function useAdminUpdateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, capacity }: { id: string; capacity: number }) => {
      await apiFetch("/api/admin-sections", { method: "PUT", body: JSON.stringify({ id, capacity }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.sections }),
  });
}

/** Admin user management */
export function useAdminAddAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (admin: { name: string; email: string; role: "primary" | "team" }) => {
      await apiFetch("/api/admin-admins", { method: "POST", body: JSON.stringify(admin) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.admins }),
  });
}

export function useAdminRemoveAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/admin-admins?id=${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.admins }),
  });
}

/** Assign G1/G2 groups to all seated students (called when section window closes) */
export function useAdminAssignGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await apiFetch("/api/admin-groups", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.students });
      qc.invalidateQueries({ queryKey: QK.myStudent });
    },
  });
}
