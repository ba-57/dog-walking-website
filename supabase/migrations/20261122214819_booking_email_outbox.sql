-- Preparation only. Apply separately after approval; never backfill historical email.
begin;
create schema if not exists private;
create table public.booking_email_outbox (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  event text not null check (event in ('receipt','admin_request','approved','declined')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','accepted','failed','suppressed','obsolete','manual_review')),
  attempts integer not null default 0 check (attempts >= 0),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  last_error text check (last_error in ('provider_rejected','provider_unavailable','test_mode','retry_limit','stale_event')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id,event)
);
alter table public.booking_email_outbox enable row level security;
revoke all on public.booking_email_outbox from public, anon, authenticated;
-- Admin UI receives status metadata only, never email payloads or worker lease tokens.
grant select (appointment_id,event,status,attempts,updated_at) on public.booking_email_outbox to authenticated;
create policy admin_read_email_status on public.booking_email_outbox for select to authenticated using ((select public.is_admin()));
create index booking_email_retry_queue on public.booking_email_outbox(appointment_id,status);

create function private.queue_booking_email_events(p_id uuid, p_events text[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.booking_email_outbox(appointment_id,event,payload)
  select a.id, event, jsonb_build_object(
    'customer_name',a.customer_name, 'email',a.email, 'phone',a.phone,
    'dog_name',a.dog_name, 'neighborhood',a.neighborhood,
    'starts_at',s.starts_at, 'timezone',settings.timezone)
  from public.appointments a join public.walk_slots s on s.id=a.slot_id
    cross join public.service_settings settings cross join unnest(p_events) as event
  where a.id=p_id and settings.id
  on conflict (appointment_id,event) do nothing;
$$;
revoke all on function private.queue_booking_email_events(uuid,text[]) from public, anon, authenticated, service_role;

-- Existing RPCs stay compatible with the currently deployed frontend/function.
-- New handlers opt into atomic booking/status + email enqueue through these wrappers.
create function public.request_walk_with_email(
 p_slot_id uuid,p_customer_name text,p_email text,p_phone text,p_dog_name text,p_neighborhood text,p_notes text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
 request_id := public.request_walk(p_slot_id,p_customer_name,p_email,p_phone,p_dog_name,p_neighborhood,p_notes);
 perform private.queue_booking_email_events(request_id,array['receipt','admin_request']);
 return request_id;
end; $$;
revoke all on function public.request_walk_with_email(uuid,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.request_walk_with_email(uuid,text,text,text,text,text,text) to service_role;

create function public.admin_review_with_email(p_id uuid,p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('approved','declined') then raise exception 'Choose approve or decline.'; end if;
 perform public.admin_review_request(p_id,p_status);
 perform private.queue_booking_email_events(p_id,array[p_status]);
end; $$;
revoke all on function public.admin_review_with_email(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_review_with_email(uuid,text) to authenticated;

-- Only a trusted backend can claim PII-bearing jobs. Locks/leases avoid concurrent workers.
create function public.claim_booking_emails(p_appointment_id uuid,p_admin_email text,p_allowed_recipient text default null)
returns table(id uuid,event text,payload jsonb,lease_token uuid)
language plpgsql security definer set search_path = '' as $$
declare job public.booking_email_outbox; current_status text; recipient text; token uuid;
begin
 for job in select o.* from public.booking_email_outbox o
   where o.appointment_id=p_appointment_id
     and (o.status in ('pending','failed','suppressed') or (o.status='processing' and o.lease_until<now()))
   order by o.created_at,o.id for update skip locked
 loop
   select a.status into current_status from public.appointments a where a.id=job.appointment_id;
   if (job.event in ('receipt','admin_request','approved') and (job.payload->>'starts_at')::timestamptz<=now())
     or (job.event in ('receipt','admin_request') and current_status<>'pending')
     or (job.event in ('approved','declined') and current_status<>job.event) then
     update public.booking_email_outbox o set status='obsolete',last_error='stale_event',updated_at=now() where o.id=job.id;
     continue;
   end if;
   -- Resend retains idempotency keys for 24h; don't automatically retry beyond 23h.
   if job.attempts>=5 or job.first_attempt_at<now()-interval '23 hours' then
     update public.booking_email_outbox o set status='manual_review',last_error='retry_limit',updated_at=now() where o.id=job.id;
     continue;
   end if;
   recipient := case when job.event='admin_request' then p_admin_email else job.payload->>'email' end;
   if p_allowed_recipient is not null and lower(recipient)<>lower(p_allowed_recipient) then
     update public.booking_email_outbox o set status='suppressed',last_error='test_mode',updated_at=now() where o.id=job.id;
     continue;
   end if;
   token := gen_random_uuid();
   update public.booking_email_outbox o set status='processing',attempts=o.attempts+1,
     first_attempt_at=coalesce(o.first_attempt_at,now()),lease_token=token,lease_until=now()+interval '2 minutes',updated_at=now()
     where o.id=job.id;
   return query select job.id,job.event,job.payload,token;
 end loop;
end; $$;
revoke all on function public.claim_booking_emails(uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_booking_emails(uuid,text,text) to service_role;

create function public.finish_booking_email(p_id uuid,p_lease_token uuid,p_status text,p_error text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 if p_status not in ('accepted','failed') or p_status is null
   or (p_error is not null and p_error not in ('provider_rejected','provider_unavailable')) then
   raise exception 'Invalid delivery result.';
 end if;
 update public.booking_email_outbox o set status=p_status,last_error=p_error,lease_token=null,lease_until=null,updated_at=now()
 where o.id=p_id and o.status='processing' and o.lease_token=p_lease_token;
 return found;
end; $$;
revoke all on function public.finish_booking_email(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.finish_booking_email(uuid,uuid,text,text) to service_role;
commit;
