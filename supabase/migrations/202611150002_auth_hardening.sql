-- Enforce first-login password changes in the database and support finance
-- accounts that are intentionally not assigned to a single class.
create or replace function public.handle_school_password_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password and auth.uid() = new.id then
    update public.profiles
    set must_change_password = false
    where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_school_password_change() from public, anon, authenticated;
drop trigger if exists school_password_changed on auth.users;
create trigger school_password_changed
after update of encrypted_password on auth.users
for each row execute function public.handle_school_password_change();

-- Password changes are now confirmed by the auth.users password update trigger.
drop function if exists public.mark_password_changed();

create or replace function public.load_school_store()
returns jsonb
language plpgsql
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
begin
  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found then raise exception 'Account profile not found'; end if;
  if v_profile.must_change_password then raise exception 'Change the temporary password before accessing school data'; end if;

  select data into v_data from public.school_store where id = 1;
  if v_profile.role = 'admin' then return v_data; end if;

  for v_class in
    select value from jsonb_array_elements(coalesce(v_data->'classes', '[]'::jsonb))
    where v_profile.role = 'finance' or value->>'id' = v_profile.class_id::text
  loop
    v_students := '[]'::jsonb;
    for v_student in
      select value from jsonb_array_elements(coalesce(v_class->'students', '[]'::jsonb))
      where v_profile.role <> 'student' or value->>'id' = v_profile.student_id::text
    loop
      if v_profile.role = 'teacher' then
        v_student := v_student - 'phone' - 'guardianName' - 'guardianPhone' - 'paid';
      elsif v_profile.role = 'finance' then
        v_student := jsonb_build_object(
          'id', v_student->'id', 'name', v_student->'name',
          'gender', v_student->'gender', 'reg', v_student->'reg',
          'paid', coalesce(v_student->'paid', 'false'::jsonb)
        );
      else
        v_student := jsonb_build_object(
          'id', v_student->'id', 'name', v_student->'name',
          'gender', v_student->'gender', 'reg', v_student->'reg',
          'admissionDate', coalesce(v_student->'admissionDate', '""'::jsonb),
          'paid', coalesce(v_student->'paid', 'false'::jsonb)
        );
      end if;
      v_students := v_students || jsonb_build_array(v_student);
    end loop;

    v_class := jsonb_set(v_class, '{students}', v_students, true);
    v_classes := v_classes || jsonb_build_array(v_class);
    if v_profile.role <> 'finance' then
      v_sessions := coalesce(v_data->'attendance'->(v_profile.class_id::text), '[]'::jsonb);
      if v_profile.role = 'student' then
        for v_session in select value from jsonb_array_elements(v_sessions)
        loop
          v_marks := coalesce(v_session->'marks', '{}'::jsonb);
          v_session := jsonb_set(v_session, '{marks}', jsonb_build_object(
            v_profile.student_id::text,
            coalesce(v_marks->(v_profile.student_id::text), '"Absent"'::jsonb)
          ), true);
          v_attendance := jsonb_set(v_attendance, array[v_profile.class_id::text],
            coalesce(v_attendance->(v_profile.class_id::text), '[]'::jsonb) || jsonb_build_array(v_session), true);
        end loop;
      else
        v_attendance := jsonb_build_object(v_profile.class_id::text, v_sessions);
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_classes) = 0 then raise exception 'Assigned class or student was not found'; end if;
  return jsonb_set(jsonb_set(v_data, '{classes}', v_classes, true), '{attendance}', v_attendance, true);
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
  v_payment jsonb;
  v_student_id text;
begin
  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found then raise exception 'Account profile not found'; end if;
  if v_profile.must_change_password then raise exception 'Change the temporary password before accessing school data'; end if;
  select data into v_data from public.school_store where id = 1 for update;

  if v_profile.role = 'admin' then
    if jsonb_typeof(payload) <> 'object'
      or jsonb_typeof(payload->'classes') <> 'array'
      or jsonb_typeof(payload->'attendance') <> 'object'
      or jsonb_typeof(payload->'profile') <> 'object'
      or jsonb_typeof(payload->'timetable') <> 'array' then raise exception 'Invalid school data'; end if;
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
    update public.school_store set data = jsonb_set(data,
      array['attendance', v_profile.class_id::text], payload->'attendance'->(v_profile.class_id::text), true)
    where id = 1;
    return;
  end if;

  if v_profile.role = 'finance' then
    if jsonb_typeof(payload->'payments') <> 'array' then raise exception 'Finance accounts may only update payment status'; end if;
    for v_payment in select value from jsonb_array_elements(payload->'payments') loop
      v_student_id := v_payment->>'id';
      if v_student_id is null or coalesce((v_payment->>'paid')::boolean, false) is not true then
        raise exception 'Finance accounts may only mark fees as paid';
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_data->'classes') c,
          jsonb_array_elements(coalesce(c->'students', '[]'::jsonb)) s
        where s->>'id' = v_student_id
      ) then raise exception 'Student record not found'; end if;
      update public.school_store set data = jsonb_set(data, '{classes}', (
        select jsonb_agg(case when c->'students' is not null then jsonb_set(c, '{students}', (
          select jsonb_agg(case when s->>'id' = v_student_id then jsonb_set(s, '{paid}', 'true'::jsonb, true) else s end)
          from jsonb_array_elements(c->'students') s
        ), true) else c end)
        from jsonb_array_elements(data->'classes') c
      ), true) where id = 1;
      select data into v_data from public.school_store where id = 1;
    end loop;
    return;
  end if;
  raise exception 'This account cannot change school data';
end;
$$;

revoke all on function public.load_school_store() from public, anon;
revoke all on function public.save_school_store(jsonb) from public, anon;
grant execute on function public.load_school_store() to authenticated;
grant execute on function public.save_school_store(jsonb) to authenticated;

