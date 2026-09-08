-- ═══════════════════════════════════════════════════════════════════
-- SectionSync — Add G1/G2 Group Assignment
-- Run this in a NEW Supabase SQL Editor tab (separate from migration.sql)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add group_number column to students
alter table public.students
  add column if not exists group_number int check (group_number in (1, 2));

-- 2. Expose in grants
grant select on public.students to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3. assign_groups() — called by admin when section window closes.
--
--    For every section:
--      - Gets all students sorted by seat number (the order they booked)
--      - First ceil(n/2) students → G1
--      - Remaining students → G2
--
--    Example:
--      50 students → G1=25, G2=25
--      49 students → G1=25, G2=24
--
--    Returns: number of students assigned
-- ─────────────────────────────────────────────────────────────────
create or replace function public.assign_groups()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section     record;
  v_student     record;
  v_rank        int;
  v_half        int;
  v_total       int := 0;
begin
  -- Loop through every section that has at least one seated student
  for v_section in
    select id from public.sections
  loop
    -- Count students in this section
    select count(*) into v_half
    from public.students
    where assigned_section_id = v_section.id
      and assigned_seat is not null;

    if v_half = 0 then
      continue;
    end if;

    -- G1 gets the first ceil(n/2) seats (more or equal)
    v_half := ceil(v_half::float / 2)::int;
    v_rank  := 0;

    -- Assign by seat order (lower seat number = G1 first)
    for v_student in
      select id
      from public.students
      where assigned_section_id = v_section.id
        and assigned_seat is not null
      order by assigned_seat asc
    loop
      v_rank := v_rank + 1;
      update public.students
      set group_number = case when v_rank <= v_half then 1 else 2 end
      where id = v_student.id;
      v_total := v_total + 1;
    end loop;
  end loop;

  return v_total;
end;
$$;

-- Grant to authenticated so the API can call it with service-role
grant execute on function public.assign_groups() to service_role;
