// ─────────────────────────────────────────────────────────────────
// SectionSync — Supabase database types
// Matches the schema in supabase/migration.sql
// ─────────────────────────────────────────────────────────────────

export type AppPhase =
  | "SPEC_WINDOW_OPEN"
  | "SPEC_WINDOW_CLOSED"
  | "SECTIONS_FINALIZED"
  | "SECTION_WINDOW_OPEN"
  | "SECTION_WINDOW_CLOSED";

// ── Row types ─────────────────────────────────────────────────────

export interface DBAdmin {
  id:        string;
  email:     string;
  name:      string;
  role:      "primary" | "team";
  added_at:  string;
}

export interface DBSystemConfig {
  id:                       number;   // always 1
  phase:                    AppPhase;
  spec_window_open:         boolean;
  section_window_open:      boolean;
  section_window_deadline:  string | null;
  updated_at:               string;
}

export interface DBSpecialization {
  id:          string;
  name:        string;
  batch:       string;
  description: string | null;
  active:      boolean;
  created_at:  string;
  updated_at:  string;
}

export interface DBSection {
  id:                string;
  specialization_id: string;
  name:              string;
  capacity:          number;
  created_at:        string;
  // joined
  specialization?:   DBSpecialization;
  occupancy?:        number;
  seats?:            DBSeat[];
}

export interface DBStudent {
  id:                         string;
  auth_id:                    string | null;
  roll_number:                string;
  name:                       string;
  email:                      string;
  year:                       number | null;
  chosen_specialization_id:   string | null;
  assigned_section_id:        string | null;
  assigned_seat:              number | null;
  group_number:               1 | 2 | null;
  created_at:                 string;
  updated_at:                 string;
  // joined
  specialization?:            DBSpecialization;
  section?:                   DBSection;
}

export interface DBSeat {
  id:          string;
  section_id:  string;
  seat_number: number;
  student_id:  string | null;
  booked_at:   string | null;
  // joined
  student?:    Pick<DBStudent, "id" | "name" | "roll_number">;
}

export interface DBOtpAttempt {
  id:         string;
  email:      string;
  ip:         string;
  action:     "send" | "verify";
  success:    boolean;
  created_at: string;
}

// ── Supabase Database generic type ───────────────────────────────
export interface Database {
  public: {
    Tables: {
      admins: {
        Row:    DBAdmin;
        Insert: Omit<DBAdmin, "id" | "added_at">;
        Update: Partial<Omit<DBAdmin, "id">>;
      };
      system_config: {
        Row:    DBSystemConfig;
        Insert: Partial<DBSystemConfig>;
        Update: Partial<DBSystemConfig>;
      };
      specializations: {
        Row:    DBSpecialization;
        Insert: Omit<DBSpecialization, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DBSpecialization, "id" | "created_at">>;
      };
      students: {
        Row:    DBStudent;
        Insert: Omit<DBStudent, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<DBStudent, "id" | "created_at">>;
      };
      sections: {
        Row:    DBSection;
        Insert: Omit<DBSection, "id" | "created_at" | "specialization" | "occupancy" | "seats">;
        Update: Partial<Pick<DBSection, "name" | "capacity">>;
      };
      seats: {
        Row:    DBSeat;
        Insert: Omit<DBSeat, "id" | "student">;
        Update: Partial<Pick<DBSeat, "student_id" | "booked_at">>;
      };
      otp_attempts: {
        Row:    DBOtpAttempt;
        Insert: Omit<DBOtpAttempt, "id" | "created_at">;
        Update: Partial<Pick<DBOtpAttempt, "success">>;
      };
      rate_limit_log: {
        Row:    { id: string; email: string; ip: string; action: string; created_at: string };
        Insert: { email?: string; ip?: string; action: string };
        Update: never;
      };
    };
    Functions: {
      book_seat: {
        Args: { p_student_id: string; p_section_id: string; p_seat_number: number };
        Returns: string;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      assign_groups: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
  };
}
