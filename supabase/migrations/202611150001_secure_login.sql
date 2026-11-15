create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique,
  display_name text not null,
  role text not null check (role in ('admin', 'teacher', 'finance', 'student')),
  class_id uuid,
  student_id uuid,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (role in ('admin', 'finance') and class_id is null and student_id is null)
    or (role = 'teacher' and class_id is not null and student_id is null)
    or (role = 'student' and class_id is not null and student_id is not null)
  )
);

create table if not exists public.school_store (
  id integer primary key check (id = 1),
  data jsonb not null
);

insert into public.school_store (id, data)
values (1, '{"classes":[],"attendance":{},"profile":{"name":"Faculty Administrator","school":"JARAN PRIVATE SCHOOL"},"timetable":[]}'::jsonb)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.school_store enable row level security;

create or replace function public.is_school_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles visible to self or admin" on public.profiles;
create policy "profiles visible to self or admin"
on public.profiles
for select
to authenticated
using (user_id = auth.uid() or public.is_school_admin());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.school_store from anon, authenticated;

create or replace function public.get_my_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'loginId', login_id,
    'displayName', display_name,
    'role', role,
    'classId', class_id,
    'studentId', student_id,
    'mustChangePassword', must_change_password
  )
  from public.profiles
  where user_id = auth.uid();
$$;

create or replace function public.mark_password_changed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set must_change_password = false
  where user_id = auth.uid();

  if not found then
    raise exception 'Account profile not found';
  end if;
end;
$$;

create or replace function public.load_school_store()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_data jsonb;
  v_classes jsonb := '[]'::jsonb;
  v_class jsonb;
  v_student jsonb;
  v_students jsonb;
  v_attendance jsonb := '{}'::jsonb;
  v_sessions jsonb;
  v_session jsonb;
  v_marks jsonb;
  v_key text;
begin
  select * into v_profile
  from public.profiles
  where user_id = auth.uid();

  if not found then
    raise exception 'Account profile not found';
  end if;

  select data into v_data from public.school_store where id = 1;
  if v_profile.role = 'admin' then
    return v_data;
  end if;

  for v_class in
    select value
    from jsonb_array_elements(coalesce(v_data->'classes', '[]'::jsonb))
    where value->>'id' = v_profile.class_id::text
  loop
    v_students := '[]'::jsonb;
    for v_student in
      select value
      from jsonb_array_elements(coalesce(v_class->'students', '[]'::jsonb))
      where v_profile.role <> 'student' or value->>'id' = v_profile.student_id::text
    loop
      if v_profile.role = 'teacher' then
        v_student := v_student - 'phone' - 'guardianName' - 'guardianPhone' - 'paid';
      elsif v_profile.role = 'finance' then
        v_student := jsonb_build_object(
          'id', v_student->'id',
          'name', v_student->'name',
          'gender', v_student->'gender',
          'reg', v_student->'reg',
          'paid', coalesce(v_student->'paid', 'false'::jsonb)
        );
      else
        v_student := jsonb_build_object(
          'id', v_student->'id',
          'name', v_student->'name',
          'gender', v_student->'gender',
          'reg', v_student->'reg',
          'admissionDate', coalesce(v_student->'admissionDate', '""'::jsonb),
          'paid', coalesce(v_student->'paid', 'false'::jsonb)
        );
      end if;
      v_students := v_students || jsonb_build_array(v_student);
    end loop;

    v_class := jsonb_set(v_class, '{students}', v_students, true);
    v_classes := v_classes || jsonb_build_array(v_class);
    v_sessions := coalesce(v_data->'attendance'->(v_profile.class_id::text), '[]'::jsonb);

    if v_profile.role = 'student' then
      for v_session in select value from jsonb_array_elements(v_sessions)
      loop
        v_marks := coalesce(v_session->'marks', '{}'::jsonb);
        v_session := jsonb_set(
          v_session,
          '{marks}',
          jsonb_build_object(
            v_profile.student_id::text,
            coalesce(v_marks->(v_profile.student_id::text), '"Absent"'::jsonb)
          ),
          true
        );
        v_attendance := jsonb_set(
          v_attendance,
          array[v_profile.class_id::text],
          coalesce(v_attendance->(v_profile.class_id::text), '[]'::jsonb) || jsonb_build_array(v_session),
          true
        );
      end loop;
    else
      v_attendance := jsonb_build_object(v_profile.class_id::text, v_sessions);
    end if;
  end loop;

  if jsonb_array_length(v_classes) = 0 then
    raise exception 'Assigned class or student was not found';
  end if;

  return jsonb_set(
    jsonb_set(v_data, '{classes}', v_classes, true),
    '{attendance}',
    v_attendance,
    true
  );
end;
$$;

create or replace function public.save_school_store(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_data jsonb;
  v_class jsonb;
  v_student jsonb;
  v_payments jsonb;
  v_payment jsonb;
  v_class_id text;
  v_student_id text;
begin
  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'Account profile not found';
  end if;

  select data into v_data from public.school_store where id = 1 for update;

  if v_profile.role = 'admin' then
    if jsonb_typeof(payload) <> 'object'
      or jsonb_typeof(payload->'classes') <> 'array'
      or jsonb_typeof(payload->'attendance') <> 'object'
      or jsonb_typeof(payload->'profile') <> 'object'
      or jsonb_typeof(payload->'timetable') <> 'array' then
      raise exception 'Invalid school data';
    end if;
    update public.school_store set data = payload where id = 1;
    return;
  end if;

  if v_profile.role = 'teacher' then
    if jsonb_typeof(payload->'attendance') <> 'object'
      or (select count(*) from jsonb_object_keys(payload->'attendance')) <> 1
      or not (payload->'attendance' ? v_profile.class_id::text)
      or jsonb_typeof(payload->'attendance'->(v_profile.class_id::text)) <> 'array' then
      raise exception 'Teachers may only save attendance for their assigned class';
    end if;
    update public.school_store
    set data = jsonb_set(
      data,
      array['attendance', v_profile.class_id::text],
      payload->'attendance'->(v_profile.class_id::text),
      true
    )
    where id = 1;
    return;
  end if;

  if v_profile.role = 'finance' then
    if jsonb_typeof(payload->'payments') <> 'array' then
      raise exception 'Finance accounts may only update payment status';
    end if;
    v_payments := payload->'payments';
    for v_payment in select value from jsonb_array_elements(v_payments)
    loop
      v_student_id := v_payment->>'id';
      if v_student_id is null or coalesce((v_payment->>'paid')::boolean, false) is not true then
        raise exception 'Finance accounts may only mark fees as paid';
      end if;

      for v_class in select value from jsonb_array_elements(data->'classes')
      loop
        if exists (
          select 1
          from jsonb_array_elements(coalesce(v_class->'students', '[]'::jsonb)) s
          where s->>'id' = v_student_id
        ) then
          update public.school_store
          set data = jsonb_set(
            data,
            array['classes'],
            (
              select jsonb_agg(
                case when c->>'id' = v_class->>'id' then
                  jsonb_set(c, '{students}', (
                    select jsonb_agg(
                      case when s->>'id' = v_student_id
                        then jsonb_set(s, '{paid}', 'true'::jsonb, true)
                        else s
                      end
                    )
                    from jsonb_array_elements(c->'students') s
                  ), true)
                else c end
              )
              from jsonb_array_elements(data->'classes') c
            ),
            true
          )
          where id = 1;
          exit;
        end if;
      end loop;
    end loop;
    return;
  end if;

  raise exception 'This account cannot change school data';
end;
$$;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.mark_password_changed() to authenticated;
grant execute on function public.load_school_store() to authenticated;
grant execute on function public.save_school_store(jsonb) to authenticated;
revoke all on function public.is_school_admin() from public, anon;
revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.mark_password_changed() from public, anon;
revoke all on function public.load_school_store() from public, anon;
revoke all on function public.save_school_store(jsonb) from public, anon;
grant execute on function public.is_school_admin() to authenticated;

