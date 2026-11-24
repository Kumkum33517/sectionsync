-- ═══════════════════════════════════════════════════════════════════
-- SectionSync — Full Database Migration
-- Paste this entire file into Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────
-- 1. ADMINS
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.admins (
  id        uuid        primary key default gen_random_uuid(),
  email     text        not null unique,
  name      text        not null,
  role      text        not null default 'team' check (role in ('primary','team')),
  added_at  timestamptz not null default now()
);

insert into public.admins (email, name, role) values
  ('manvibreja@ncuindia.edu', 'Manvi Breja',  'primary'),
  ('kumkum33517@gmail.com',   'Kumkum Singh', 'team')
on conflict (email) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- 2. SYSTEM CONFIG  (single row, id always = 1)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.system_config (
  id                        int         primary key default 1,
  phase                     text        not null default 'SPEC_WINDOW_OPEN'
                              check (phase in (
                                'SPEC_WINDOW_OPEN','SPEC_WINDOW_CLOSED',
                                'SECTIONS_FINALIZED',
                                'SECTION_WINDOW_OPEN','SECTION_WINDOW_CLOSED'
                              )),
  spec_window_open          boolean     not null default true,
  spec_window_new_only      boolean     not null default false,
  section_window_open       boolean     not null default false,
  section_window_new_only   boolean     not null default false,
  section_window_deadline   timestamptz,
  updated_at                timestamptz not null default now(),
  constraint one_row check (id = 1)
);

insert into public.system_config (id) values (1)
on conflict (id) do nothing;

-- Add new_only columns to existing deployments (safe to run repeatedly)
alter table public.system_config
  add column if not exists spec_window_new_only    boolean not null default false,
  add column if not exists section_window_new_only boolean not null default false;

-- ─────────────────────────────────────────────────────────────────
-- 3. SPECIALIZATIONS
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.specializations (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  batch       text        not null default '2024-25',
  description text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.specializations (name, batch, description, active) values
  ('Data Science',    '2024-25', 'Statistics, ML foundations, data pipelines, and analytics.', true),
  ('AI/ML',           '2024-25', 'Deep learning, NLP, computer vision, and research.',          true),
  ('Full Stack',      '2024-25', 'Web development, APIs, databases, and modern frameworks.',    true),
  ('Cybersecurity',   '2024-25', 'Network security, ethical hacking, and cryptography.',        true),
  ('Cloud Computing', '2024-25', 'AWS/Azure/GCP, DevOps, and distributed systems.',             true)
on conflict (name) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- 4. SECTIONS  (must come BEFORE students so the FK can resolve)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.sections (
  id                uuid        primary key default gen_random_uuid(),
  specialization_id uuid        not null references public.specializations(id) on delete cascade,
  name              text        not null,
  capacity          int         not null default 50,
  created_at        timestamptz not null default now(),
  unique (specialization_id, name)
);

-- ─────────────────────────────────────────────────────────────────
-- 5. STUDENTS  (references sections, so sections must exist first)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.students (
  id                        uuid        primary key default gen_random_uuid(),
  auth_id                   uuid        unique references auth.users(id) on delete set null,
  roll_number               text        not null unique,
  name                      text        not null,
  email                     text        not null unique,
  year                      int,
  chosen_specialization_id  uuid        references public.specializations(id) on delete set null,
  assigned_section_id       uuid        references public.sections(id)        on delete set null,
  assigned_seat             int,
  group_number              int,          -- 1 = G1, 2 = G2, assigned when section window closes
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- 6. SEATS  (one row per physical seat — the race-condition guard)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.seats (
  id          uuid        primary key default gen_random_uuid(),
  section_id  uuid        not null references public.sections(id)  on delete cascade,
  seat_number int         not null,
  student_id  uuid        unique references public.students(id)    on delete set null,
  booked_at   timestamptz,
  unique (section_id, seat_number)    -- THE atomic uniqueness guard
);

-- ─────────────────────────────────────────────────────────────────
-- 7. OTP RATE-LIMITING ATTEMPTS LOG
--    Only tracks OTP send/verify. action CHECK is intentionally strict.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.otp_attempts (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null,
  ip         text        not null default 'unknown',
  action     text        not null check (action in ('send','verify')),
  success    boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists otp_attempts_email_idx on public.otp_attempts (email, action, created_at desc);
create index if not exists otp_attempts_ip_idx    on public.otp_attempts (ip,    action, created_at desc);

-- ─────────────────────────────────────────────────────────────────
-- 7b. GENERAL RATE LIMIT LOG
--     For all non-OTP routes (admin endpoints, seat booking, etc.)
--     No CHECK constraint on action — accepts any route identifier.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.rate_limit_log (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null default 'unknown',
  ip         text        not null default 'unknown',
  action     text        not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_log_email_idx on public.rate_limit_log (email, action, created_at desc);
create index if not exists rate_limit_log_ip_idx    on public.rate_limit_log (ip,    action, created_at desc);

-- RLS: no direct client access — only service_role (our API functions)
alter table public.rate_limit_log enable row level security;
create policy "rate_limit_log_no_access" on public.rate_limit_log
  for all using (false);
revoke all on public.rate_limit_log from anon, authenticated;
grant all   on public.rate_limit_log to service_role;

-- ─────────────────────────────────────────────────────────────────
-- 8. OTHER INDEXES
-- ─────────────────────────────────────────────────────────────────
create index if not exists students_email_idx    on public.students (lower(email));
create index if not exists students_auth_id_idx  on public.students (auth_id);
create index if not exists students_spec_idx     on public.students (chosen_specialization_id);
create index if not exists students_section_idx  on public.students (assigned_section_id);
create index if not exists sections_spec_idx     on public.sections (specialization_id);
create index if not exists seats_section_idx     on public.seats    (section_id);
create index if not exists seats_student_idx     on public.seats    (student_id);

-- ─────────────────────────────────────────────────────────────────
-- 9. UPDATED_AT TRIGGER
-- ─────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger students_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

create or replace trigger specializations_updated_at
  before update on public.specializations
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- 10. ADMIN CHECK FUNCTION
--     Used inside RLS policies. SECURITY DEFINER so it can read
--     the admins table even when RLS would otherwise block it.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.admins
    where lower(email) = lower(
      (select email from auth.users where id = auth.uid())
    )
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 11. ATOMIC SEAT BOOKING FUNCTION
--     Returns: 'ok' | 'seat_taken' | 'window_closed' |
--              'wrong_specialization' | 'invalid_seat' |
--              'student_not_found' | 'section_not_found'
-- ─────────────────────────────────────────────────────────────────
create or replace function public.book_seat(
  p_student_id  uuid,
  p_section_id  uuid,
  p_seat_number int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat_row    public.seats%rowtype;
  v_student_row public.students%rowtype;
  v_section_row public.sections%rowtype;
  v_config_row  public.system_config%rowtype;
begin
  -- 1. Window must be open
  select * into v_config_row from public.system_config where id = 1;
  if not v_config_row.section_window_open then
    return 'window_closed';
  end if;

  -- 2. Lock student row (prevents double-booking same student)
  select * into v_student_row
  from public.students where id = p_student_id
  for update;
  if not found then return 'student_not_found'; end if;

  -- 3. Load section
  select * into v_section_row
  from public.sections where id = p_section_id;
  if not found then return 'section_not_found'; end if;

  -- 4. Section must match student's chosen specialization
  if v_student_row.chosen_specialization_id is null
     or v_student_row.chosen_specialization_id != v_section_row.specialization_id then
    return 'wrong_specialization';
  end if;

  -- 5. Seat number must be within section capacity
  if p_seat_number < 1 or p_seat_number > v_section_row.capacity then
    return 'invalid_seat';
  end if;

  -- 6. Try to lock the exact seat row atomically (NOWAIT = fail fast)
  begin
    select * into v_seat_row
    from public.seats
    where section_id = p_section_id and seat_number = p_seat_number
    for update nowait;

    if found
       and v_seat_row.student_id is not null
       and v_seat_row.student_id != p_student_id then
      return 'seat_taken';
    end if;
  exception when lock_not_available then
    return 'seat_taken';
  end;

  -- 7. Release any previous seat this student held
  update public.seats
  set student_id = null, booked_at = null
  where student_id = p_student_id;

  -- 8. Claim the new seat (upsert)
  insert into public.seats (section_id, seat_number, student_id, booked_at)
  values (p_section_id, p_seat_number, p_student_id, now())
  on conflict (section_id, seat_number) do update
    set student_id = excluded.student_id,
        booked_at  = excluded.booked_at
  where seats.student_id is null
     or seats.student_id = p_student_id;

  -- 9. Verify we actually own it (guard against edge case)
  select * into v_seat_row
  from public.seats
  where section_id = p_section_id and seat_number = p_seat_number;

  if v_seat_row.student_id != p_student_id then
    return 'seat_taken';
  end if;

  -- 10. Update student record
  update public.students
  set assigned_section_id = p_section_id,
      assigned_seat        = p_seat_number,
      updated_at           = now()
  where id = p_student_id;

  return 'ok';
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 12. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────

-- admins
alter table public.admins enable row level security;
create policy "admins_select" on public.admins
  for select using (public.is_admin());
create policy "admins_insert" on public.admins
  for insert with check (public.is_admin());
create policy "admins_delete" on public.admins
  for delete using (
    public.is_admin()
    and lower(email) != lower(
      (select email from auth.users where id = auth.uid())
    )
  );

-- system_config
alter table public.system_config enable row level security;
create policy "config_select" on public.system_config
  for select using (auth.uid() is not null);
create policy "config_update" on public.system_config
  for update using (public.is_admin()) with check (public.is_admin());

-- specializations
alter table public.specializations enable row level security;
create policy "specs_select" on public.specializations
  for select using (auth.uid() is not null);
create policy "specs_insert" on public.specializations
  for insert with check (public.is_admin());
create policy "specs_update" on public.specializations
  for update using (public.is_admin()) with check (public.is_admin());
create policy "specs_delete" on public.specializations
  for delete using (public.is_admin());

-- students
alter table public.students enable row level security;
create policy "students_select" on public.students
  for select using (auth_id = auth.uid() or public.is_admin());
create policy "students_insert" on public.students
  for insert with check (public.is_admin());
create policy "students_update" on public.students
  for update
  using  (auth_id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth_id = auth.uid()
      and roll_number = (select roll_number from public.students s2 where s2.id = students.id)
      and email       = (select email       from public.students s2 where s2.id = students.id)
      and year        = (select year        from public.students s2 where s2.id = students.id)
    )
  );
create policy "students_delete" on public.students
  for delete using (public.is_admin());

-- sections
alter table public.sections enable row level security;
create policy "sections_select" on public.sections
  for select using (auth.uid() is not null);
create policy "sections_insert" on public.sections
  for insert with check (public.is_admin());
create policy "sections_update" on public.sections
  for update using (public.is_admin()) with check (public.is_admin());
create policy "sections_delete" on public.sections
  for delete using (public.is_admin());

-- seats (reads open; writes only via book_seat() SECURITY DEFINER function)
alter table public.seats enable row level security;
create policy "seats_select" on public.seats
  for select using (auth.uid() is not null);

-- otp_attempts (no direct client access at all)
alter table public.otp_attempts enable row level security;
create policy "otp_no_direct_access" on public.otp_attempts
  for all using (false);

-- ─────────────────────────────────────────────────────────────────
-- 13. GRANTS
-- ─────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select on public.specializations, public.sections, public.seats, public.system_config to authenticated;
grant select, update on public.students to authenticated;
grant execute on function public.book_seat(uuid, uuid, int) to authenticated;
grant execute on function public.is_admin() to authenticated;
revoke all on public.otp_attempts  from anon, authenticated;
grant all   on public.otp_attempts  to service_role;
grant all   on public.admins        to service_role;
-- rate_limit_log grants are set inline above where the table is created

-- ═══════════════════════════════════════════════════════════════════
-- Migration complete.
-- Tables: admins, system_config, specializations, sections, students, seats, otp_attempts
-- Functions: is_admin(), book_seat(), set_updated_at()
-- RLS enabled on all 7 tables.
-- ═══════════════════════════════════════════════════════════════════
