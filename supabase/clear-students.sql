-- Run in Supabase SQL Editor
-- Creates a function that safely clears all students (bypasses FK constraints)
create or replace function public.clear_all_students()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Clear seats first (references students)
  update public.seats set student_id = null;
  -- Clear auth_id links
  update public.students set auth_id = null, 
    chosen_specialization_id = null,
    assigned_section_id = null,
    assigned_seat = null,
    group_number = null;
  -- Now delete all students
  delete from public.students;
end;
$$;

grant execute on function public.clear_all_students() to service_role;
