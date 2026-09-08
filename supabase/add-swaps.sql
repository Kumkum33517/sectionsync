-- ═══════════════════════════════════════════════════════════════════
-- SectionSync — Section Swap Requests
-- Run in a NEW Supabase SQL Editor tab
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.swap_requests (
  id              uuid        primary key default gen_random_uuid(),
  requester_id    uuid        not null references public.students(id) on delete cascade,
  target_id       uuid        not null references public.students(id) on delete cascade,
  -- sections at the time the request was made (for display)
  requester_section_id uuid   references public.sections(id) on delete set null,
  target_section_id    uuid   references public.sections(id) on delete set null,
  status          text        not null default 'PENDING'
                    check (status in ('PENDING','ACCEPTED','REJECTED','CANCELLED')),
  note            text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  -- A student can only have one pending outgoing request at a time
  unique (requester_id, status) deferrable initially deferred
);

create index if not exists swap_requests_requester_idx on public.swap_requests (requester_id, status);
create index if not exists swap_requests_target_idx    on public.swap_requests (target_id,    status);

-- RLS
alter table public.swap_requests enable row level security;

-- Students can see requests they sent or received
create policy "swap_select" on public.swap_requests
  for select using (
    requester_id = (select id from public.students where auth_id = auth.uid())
    or target_id = (select id from public.students where auth_id = auth.uid())
    or public.is_admin()
  );

-- Students can insert their own requests (requester_id must be themselves)
create policy "swap_insert" on public.swap_requests
  for insert with check (
    requester_id = (select id from public.students where auth_id = auth.uid())
  );

-- Only the target or admin can update (accept/reject); requester can cancel
create policy "swap_update" on public.swap_requests
  for update using (
    target_id = (select id from public.students where auth_id = auth.uid())
    or requester_id = (select id from public.students where auth_id = auth.uid())
    or public.is_admin()
  );

grant select, insert, update on public.swap_requests to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- Atomic swap function
-- Swaps sections between two students in one transaction.
-- Both must be in the same specialization.
-- Returns 'ok' | 'window_closed' | 'not_same_spec' | 'request_not_pending'
-- ─────────────────────────────────────────────────────────────────
create or replace function public.execute_swap(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req       public.swap_requests%rowtype;
  v_req_s     public.students%rowtype;
  v_tgt_s     public.students%rowtype;
  v_config    public.system_config%rowtype;
begin
  -- 1. Window must be open
  select * into v_config from public.system_config where id = 1;
  if not v_config.section_window_open then return 'window_closed'; end if;

  -- 2. Load and lock the request
  select * into v_req from public.swap_requests where id = p_request_id for update;
  if not found or v_req.status != 'PENDING' then return 'request_not_pending'; end if;

  -- 3. Lock both student rows
  select * into v_req_s from public.students where id = v_req.requester_id for update;
  select * into v_tgt_s from public.students where id = v_req.target_id   for update;

  -- 4. Must be in same specialization
  if v_req_s.chosen_specialization_id != v_tgt_s.chosen_specialization_id then
    return 'not_same_spec';
  end if;

  -- 5. Swap sections and seats atomically
  update public.students
    set assigned_section_id = v_tgt_s.assigned_section_id,
        assigned_seat        = v_tgt_s.assigned_seat,
        updated_at           = now()
    where id = v_req_s.id;

  update public.students
    set assigned_section_id = v_req_s.assigned_section_id,
        assigned_seat        = v_req_s.assigned_seat,
        updated_at           = now()
    where id = v_tgt_s.id;

  -- 6. Also swap the seats table rows
  update public.seats set student_id = v_tgt_s.id
    where section_id = v_req_s.assigned_section_id and seat_number = v_req_s.assigned_seat;
  update public.seats set student_id = v_req_s.id
    where section_id = v_tgt_s.assigned_section_id and seat_number = v_tgt_s.assigned_seat;

  -- 7. Mark request completed
  update public.swap_requests
    set status = 'ACCEPTED', resolved_at = now()
    where id = p_request_id;

  return 'ok';
end;
$$;

grant execute on function public.execute_swap(uuid) to authenticated;
