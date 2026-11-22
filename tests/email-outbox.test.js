import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const admin = "11111111-1111-4111-8111-111111111111",
  visitor = "22222222-2222-4222-8222-222222222222";

test("email outbox is private, transactional, leased and idempotent without changing existing booking RPCs", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611100001_booking.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("insert into auth.users values($1),($2)", [admin, visitor]);
  await db.query("insert into public.admin_users values($1)", [admin]);
  async function as(role, user, sql, args = []) {
    await db.exec("begin");
    try {
      await db.exec("set local role " + role);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user || "",
      ]);
      const rows = (await db.query(sql, args)).rows;
      await db.exec("commit");
      return rows;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  }
  const slot = async (offset) =>
    (
      await as(
        "authenticated",
        admin,
        "select public.admin_add_slot(current_date+$1::int,'15:00') as id",
        [offset],
      )
    )[0].id;
  const request = async (slotId, legacy = false) =>
    (
      await as(
        "service_role",
        null,
        `select public.${legacy ? "request_walk" : "request_walk_with_email"}($1,'Neighbor',$2,'5550100100','Sunny','Example area','Do not copy these notes') as id`,
        [slotId, slotId + "@example.test"],
      )
    )[0].id;
  const claim = (id, recipient = null) =>
    as(
      "service_role",
      null,
      "select * from public.claim_booking_emails($1,$2,$3)",
      [id, "team@example.test", recipient],
    );
  const finish = (job, status = "accepted") =>
    as(
      "service_role",
      null,
      "select public.finish_booking_email($1,$2,$3,$4) as ok",
      [
        job.id,
        job.lease_token,
        status,
        status === "failed" ? "provider_unavailable" : null,
      ],
    );
  const review = (id, status, user = admin) =>
    as("authenticated", user, "select public.admin_review_with_email($1,$2)", [
      id,
      status,
    ]);
  const historical = await request(await slot(1), true);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261122214819_booking_email_outbox.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  let booking;
  await t.test(
    "migration does not enqueue old customer mail; original booking RPC remains compatible",
    async () => {
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.booking_email_outbox",
          )
        ).rows[0].n,
        0,
      );
      assert.deepEqual(await claim(historical), []);
      const old = await request(await slot(2), true);
      assert.deepEqual(await claim(old), []);
    },
  );
  await t.test(
    "new booking atomically queues separate receipt and admin jobs without notes or duplicate appointments",
    async () => {
      const time = await slot(3);
      booking = await request(time);
      const jobs = await db.query(
        "select event,payload from public.booking_email_outbox where appointment_id=$1",
        [booking],
      );
      assert.deepEqual(jobs.rows.map((r) => r.event).sort(), [
        "admin_request",
        "receipt",
      ]);
      assert.equal(jobs.rows[0].payload.customer_name, "Neighbor");
      assert.ok(!JSON.stringify(jobs.rows).includes("Do not copy these notes"));
      await assert.rejects(request(time), /no longer available/);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.booking_email_outbox where appointment_id=$1",
            [booking],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    "anonymous/non-admin reads and queue mutations are denied; admin gets status columns only",
    async () => {
      await assert.rejects(
        as("anon", null, "select * from public.booking_email_outbox"),
        /permission denied/,
      );
      assert.deepEqual(
        await as(
          "authenticated",
          visitor,
          "select appointment_id,event,status,attempts,updated_at from public.booking_email_outbox",
        ),
        [],
      );
      assert.equal(
        (
          await as(
            "authenticated",
            admin,
            "select appointment_id,event,status from public.booking_email_outbox",
          )
        ).length,
        2,
      );
      await assert.rejects(
        as(
          "authenticated",
          admin,
          "select payload from public.booking_email_outbox",
        ),
        /permission denied/,
      );
      for (const role of ["anon", "authenticated"]) {
        await assert.rejects(
          as(
            role,
            role === "authenticated" ? admin : null,
            "select * from public.claim_booking_emails($1,$2,null)",
            [booking, "team@example.test"],
          ),
          /permission denied/,
        );
        await assert.rejects(
          as(
            role,
            role === "authenticated" ? admin : null,
            "select public.finish_booking_email($1,$2,'accepted',null)",
            [booking, booking],
          ),
          /permission denied/,
        );
        await assert.rejects(
          as(
            role,
            role === "authenticated" ? admin : null,
            "select public.request_walk_with_email(null,'Name','a@b.test','5550100','Dog','Area','')",
          ),
          /permission denied/,
        );
      }
    },
  );
  await t.test(
    "sandbox recipient restrictions persist visibly without starting the retry clock",
    async () => {
      const claimed = await claim(booking, "team@example.test");
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0].event, "admin_request");
      const row = (
        await db.query(
          "select status,attempts,first_attempt_at from public.booking_email_outbox where appointment_id=$1 and event='receipt'",
          [booking],
        )
      ).rows[0];
      assert.equal(row.status, "suppressed");
      assert.equal(row.attempts, 0);
      assert.equal(row.first_attempt_at, null);
      await finish(claimed[0]);
    },
  );
  await t.test(
    "jobs are leased; failed retries keep their ID, change the lease, and stop after acceptance",
    async () => {
      const first = (await claim(booking))[0];
      assert.equal(first.event, "receipt");
      assert.deepEqual(await claim(booking), []);
      assert.equal(
        (await finish({ ...first, lease_token: booking }))[0].ok,
        false,
      );
      await finish(first, "failed");
      const retry = (await claim(booking))[0];
      assert.equal(retry.id, first.id);
      assert.notEqual(retry.lease_token, first.lease_token);
      await finish(retry);
      assert.deepEqual(await claim(booking), []);
    },
  );
  await t.test(
    "only an admin can review; updates and jobs commit together; repeated transitions cannot queue duplicate decision emails",
    async () => {
      await assert.rejects(
        review(booking, "approved", visitor),
        /Administrator access/,
      );
      await review(booking, "approved");
      await assert.rejects(review(booking, "approved"), /already changed/);
      const jobs = await claim(booking);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].event, "approved");
      await finish(jobs[0]);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.booking_email_outbox where appointment_id=$1 and event='approved'",
            [booking],
          )
        ).rows[0].n,
        1,
      );
      const next = await request(await slot(4));
      await db.exec(`create function public.reject_email_test() returns trigger language plpgsql as $$begin raise exception 'queue insert unavailable';end;$$;
   create trigger reject_email_test before insert on public.booking_email_outbox for each row execute function public.reject_email_test();`);
      await assert.rejects(
        review(next, "declined"),
        /queue insert unavailable/,
      );
      assert.equal(
        (
          await db.query("select status from public.appointments where id=$1", [
            next,
          ])
        ).rows[0].status,
        "pending",
      );
      await db.exec(
        "drop trigger reject_email_test on public.booking_email_outbox;drop function public.reject_email_test()",
      );
      await review(next, "declined");
      const decision = await claim(next);
      assert.deepEqual(
        decision.map((j) => j.event),
        ["declined"],
      );
      const obsolete = (
        await db.query(
          "select count(*)::int as n from public.booking_email_outbox where appointment_id=$1 and status='obsolete'",
          [next],
        )
      ).rows[0].n;
      assert.equal(obsolete, 2);
    },
  );
  await t.test(
    "queued receipts and approvals for past walking times are not sent",
    async () => {
      const stale = await request(await slot(8));
      await db.query(
        "update public.booking_email_outbox set payload=jsonb_set(payload,'{starts_at}',to_jsonb((now()-interval '1 day')::text)) where appointment_id=$1",
        [stale],
      );
      assert.deepEqual(await claim(stale), []);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.booking_email_outbox where appointment_id=$1 and status='obsolete'",
            [stale],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    "crash recovery leases and 23-hour/five-attempt limits avoid unsafe duplicate mail",
    async () => {
      const next = await request(await slot(5));
      const first = await claim(next);
      await db.query(
        "update public.booking_email_outbox set lease_until=now()-interval '1 minute' where appointment_id=$1",
        [next],
      );
      const recovered = await claim(next);
      assert.equal(recovered.length, 2);
      assert.equal(recovered[0].id, first[0].id);
      assert.notEqual(recovered[0].lease_token, first[0].lease_token);
      for (const j of recovered) await finish(j, "failed");
      await db.query(
        "update public.booking_email_outbox set first_attempt_at=now()-interval '24 hours' where appointment_id=$1",
        [next],
      );
      assert.deepEqual(await claim(next), []);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.booking_email_outbox where appointment_id=$1 and status='manual_review'",
            [next],
          )
        ).rows[0].n,
        2,
      );
      const capped = await request(await slot(6));
      await db.query(
        "update public.booking_email_outbox set attempts=5 where appointment_id=$1",
        [capped],
      );
      assert.deepEqual(await claim(capped), []);
    },
  );
});
