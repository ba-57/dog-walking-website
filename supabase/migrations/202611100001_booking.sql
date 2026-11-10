-- Run once in a fresh Supabase project. All times are absolute instants;
-- calendar dates use the service's configured IANA timezone, never the browser timezone.
begin;

create table public.service_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'UTC'
);
insert into public.service_settings default values;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.blocked_dates (
  day date primary key
);
create table public.walk_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_open boolean not null default true,
  check (ends_at = starts_at + interval '30 minutes'),
  -- One walking team: even differently-starting slots cannot overlap.
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.walk_slots(id),
  customer_name text not null check (length(customer_name) between 1 and 100),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null check (length(phone) between 7 and 30),
  dog_name text not null check (length(dog_name) between 1 and 80),
  neighborhood text not null check (length(neighborhood) between 1 and 200),
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The final arbiter, including concurrent requests: pending holds a slot too.
create unique index one_active_appointment_per_slot on public.appointments(slot_id)
  where status in ('pending','approved');

alter table public.service_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.blocked_dates enable row level security;
alter table public.walk_slots enable row level security;
alter table public.appointments enable row level security;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()); $$;

create policy admin_read_settings on public.service_settings for select to authenticated using (public.is_admin());
create policy admin_read_blocks on public.blocked_dates for select to authenticated using (public.is_admin());
create policy admin_read_slots on public.walk_slots for select to authenticated using (public.is_admin());
create policy admin_read_appointments on public.appointments for select to authenticated using (public.is_admin());
-- No policy or API grants expose the admin membership table.
revoke all on public.service_settings, public.admin_users, public.blocked_dates, public.walk_slots, public.appointments from public, anon, authenticated;
grant select on public.service_settings, public.blocked_dates, public.walk_slots, public.appointments to authenticated;

create function public.get_public_calendar() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tz text; first_day date;
begin
  select timezone into tz from public.service_settings where id;
  first_day := (now() at time zone tz)::date;
  return jsonb_build_object(
    'timezone', tz, 'today', first_day, 'last_date', first_day + 29,
    'slots', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'day', (s.starts_at at time zone tz)::date) order by s.starts_at)
      from public.walk_slots s where s.is_open and s.starts_at > now()
      and (s.starts_at at time zone tz)::date between first_day and first_day + 29
      and not exists (select 1 from public.blocked_dates b where b.day = (s.starts_at at time zone tz)::date)
      and not exists (select 1 from public.appointments a where a.slot_id = s.id and a.status in ('pending','approved'))
    ), '[]'::jsonb));
end; $$;

create function public.request_walk(
  p_slot_id uuid, p_customer_name text, p_email text, p_phone text,
  p_dog_name text, p_neighborhood text, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.walk_slots; tz text; first_day date; request_id uuid;
begin
  -- Same transaction lock in every mutation: booking cannot race a date block,
  -- availability change, approval, or another request.
  perform pg_advisory_xact_lock(782310);
  select * into s from public.walk_slots where id = p_slot_id for update;
  select timezone into tz from public.service_settings where id;
  first_day := (now() at time zone tz)::date;
  if s.id is null or not s.is_open or s.starts_at <= now()
    or (s.starts_at at time zone tz)::date not between first_day and first_day + 29
    or exists (select 1 from public.blocked_dates where day = (s.starts_at at time zone tz)::date)
    or exists (select 1 from public.appointments where slot_id = s.id and status in ('pending','approved')) then
    raise exception 'This time is no longer available. Please choose another.' using errcode = 'P0001';
  end if;
  -- Additional per-contact limit behind the CAPTCHA-verifying Edge Function.
  if (select count(*) from public.appointments where email = lower(btrim(p_email))
      and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'Please contact the team before requesting more walks.' using errcode = 'P0001';
  end if;
  insert into public.appointments (slot_id, customer_name, email, phone, dog_name, neighborhood, notes)
    values (s.id, btrim(p_customer_name), lower(btrim(p_email)), btrim(p_phone), btrim(p_dog_name), btrim(p_neighborhood), btrim(coalesce(p_notes, '')))
    returning id into request_id;
  return request_id;
exception when unique_violation then
  raise exception 'This time is no longer available. Please choose another.' using errcode = 'P0001';
end; $$;

create function public.admin_add_slot(p_day date, p_time time) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tz text; start_time timestamptz; slot_id uuid; first_day date;
begin
  if not public.is_admin() then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(782310);
  select timezone into tz from public.service_settings where id;
  first_day := (now() at time zone tz)::date;
  start_time := (p_day + p_time) at time zone tz;
  if p_day is null or p_time is null or p_day not between first_day and first_day + 29 or start_time <= now()
    or (start_time at time zone tz) <> (p_day + p_time)
    or ((start_time + interval '30 minutes') at time zone tz)::date <> p_day then
    raise exception 'Choose a valid future 30-minute time within the next 30 days.';
  end if;
  if exists (select 1 from public.blocked_dates where day = p_day) then raise exception 'Unblock this date before adding availability.'; end if;
  insert into public.walk_slots (starts_at, ends_at) values (start_time, start_time + interval '30 minutes') returning id into slot_id;
  return slot_id;
exception when exclusion_violation then
  raise exception 'This overlaps an existing time. Reopen that slot or choose a different time.';
end; $$;

create function public.admin_set_slot(p_slot_id uuid, p_is_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(782310);
  if p_is_open is null then raise exception 'Choose open or closed.'; end if;
  if exists (select 1 from public.appointments where slot_id = p_slot_id and status in ('pending','approved')) then
    raise exception 'Cancel or decline the active appointment before changing this slot.';
  end if;
  update public.walk_slots set is_open = p_is_open where id = p_slot_id;
  if not found then raise exception 'Slot not found.'; end if;
end; $$;

create function public.admin_block_date(p_day date, p_blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare tz text; first_day date;
begin
  if not public.is_admin() then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(782310);
  select timezone into tz from public.service_settings where id;
  first_day := (now() at time zone tz)::date;
  if p_day is null or p_blocked is null or p_day not between first_day and first_day + 29 then raise exception 'Choose a date in the next 30 days.'; end if;
  if p_blocked then
    if exists (select 1 from public.appointments a join public.walk_slots s on s.id = a.slot_id
      where (s.starts_at at time zone tz)::date = p_day and a.status in ('pending','approved')) then
      raise exception 'This date has active appointments. Contact those neighbors, then decline or cancel each appointment first.';
    end if;
    insert into public.blocked_dates(day) values(p_day) on conflict do nothing;
  else
    delete from public.blocked_dates where day = p_day;
  end if;
end; $$;

create function public.admin_review_request(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; s public.walk_slots; tz text;
begin
  if not public.is_admin() then raise exception 'Administrator access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(782310);
  select * into a from public.appointments where id = p_id for update;
  if a.id is null then raise exception 'Request not found.'; end if;
  if p_status is null or not ((a.status = 'pending' and p_status in ('approved','declined','cancelled'))
    or (a.status = 'approved' and p_status = 'cancelled')) then raise exception 'This request has already changed. Refresh the dashboard.'; end if;
  if p_status = 'approved' then
    select * into s from public.walk_slots where id = a.slot_id;
    select timezone into tz from public.service_settings where id;
    if s.starts_at <= now() or not s.is_open or exists (select 1 from public.blocked_dates where day = (s.starts_at at time zone tz)::date) then
      raise exception 'This time can no longer be approved.';
    end if;
  end if;
  update public.appointments set status = p_status, updated_at = now() where id = p_id;
end; $$;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Explicitly revoke it on every function.
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.get_public_calendar() from public, anon, authenticated;
revoke all on function public.request_walk(uuid,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.get_public_calendar() to anon, authenticated;
-- Only the CAPTCHA-verifying Edge Function may submit requests.
grant execute on function public.request_walk(uuid,text,text,text,text,text,text) to service_role;
revoke all on function public.admin_add_slot(date,time), public.admin_set_slot(uuid,boolean), public.admin_block_date(date,boolean), public.admin_review_request(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_add_slot(date,time), public.admin_set_slot(uuid,boolean), public.admin_block_date(date,boolean), public.admin_review_request(uuid,text) to authenticated;
commit;
