import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const admin = "11111111-1111-4111-8111-111111111111";
const visitor = "22222222-2222-4222-8222-222222222222";

test("Supabase migration, privileges, RLS and booking lifecycle on PostgreSQL", async (t) => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611100001_booking.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("insert into auth.users values ($1), ($2)", [admin, visitor]);
  await db.query("insert into public.admin_users values ($1)", [admin]);
  const as = async (role, uid, sql, args = []) => {
    await db.exec("begin");
    try {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
        uid || "",
      ]);
      const result = await db.query(sql, args);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  };
  const add = async (offset, time = "15:00") =>
    (
      await as(
        "authenticated",
        admin,
        `select public.admin_add_slot(((now() at time zone 'UTC')::date + $1::int), $2::time) as id`,
        [offset, time],
      )
    )[0].id;
  const calendar = async () =>
    (await as("anon", null, "select public.get_public_calendar() as data"))[0]
      .data;
  const request = (slot, email = "neighbor@example.test") =>
    as(
      "service_role",
      null,
      "select public.request_walk($1,$2,$3,$4,$5,$6,$7) as id",
      [
        slot,
        "Sample Neighbor",
        email,
        "555-010-0100",
        "Sunny",
        "Example area",
        "Gentle pace",
      ],
    );
  let slot, booking;
  await t.test(
    "public receives only window, timezone and safe slot fields",
    async () => {
      slot = await add(1);
      const c = await calendar();
      assert.equal(c.timezone, "UTC");
      assert.equal((new Date(c.last_date) - new Date(c.today)) / 86400000, 29);
      assert.equal(c.slots.length, 1);
      assert.deepEqual(Object.keys(c.slots[0]).sort(), [
        "day",
        "ends_at",
        "id",
        "starts_at",
      ]);
    },
  );
  await t.test(
    "unauthenticated users cannot select any base table, write, or call admin RPCs",
    async () => {
      await assert.rejects(
        as(
          "anon",
          null,
          "select public.request_walk(null,'Name','a@b.test','5550100','Dog','Area','')",
        ),
        /permission denied/,
      );
      await assert.rejects(
        as(
          "authenticated",
          visitor,
          "select public.request_walk(null,'Name','a@b.test','5550100','Dog','Area','')",
        ),
        /permission denied/,
      );
      for (const table of [
        "appointments",
        "admin_users",
        "walk_slots",
        "blocked_dates",
        "service_settings",
      ]) {
        await assert.rejects(
          as("anon", null, `select * from public.${table}`),
          /permission denied/,
        );
      }
      await assert.rejects(
        as("anon", null, "select public.admin_block_date(current_date+1,true)"),
        /permission denied/,
      );
      await assert.rejects(
        as(
          "anon",
          null,
          "insert into public.admin_users values ('33333333-3333-4333-8333-333333333333')",
        ),
        /permission denied/,
      );
      await assert.rejects(
        as(
          "anon",
          null,
          "insert into public.appointments(slot_id) values ($1)",
          [slot],
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "authenticated non-admin is denied customer data, membership and all mutations",
    async () => {
      assert.equal(
        (
          await as(
            "authenticated",
            visitor,
            "select public.is_admin() as allowed",
          )
        )[0].allowed,
        false,
      );
      assert.deepEqual(
        await as("authenticated", visitor, "select * from public.appointments"),
        [],
      );
      await assert.rejects(
        as("authenticated", visitor, "select * from public.admin_users"),
        /permission denied/,
      );
      await assert.rejects(
        as(
          "authenticated",
          visitor,
          "select public.admin_block_date(current_date+1,true)",
        ),
        /Administrator access/,
      );
      await assert.rejects(
        as(
          "authenticated",
          visitor,
          "select public.admin_add_slot(current_date+1,'17:00')",
        ),
        /Administrator access/,
      );
      await assert.rejects(
        as("authenticated", visitor, "select public.admin_set_slot($1,false)", [
          slot,
        ]),
        /Administrator access/,
      );
      await assert.rejects(
        as(
          "authenticated",
          visitor,
          "update public.walk_slots set is_open = false",
        ),
        /permission denied/,
      );
      await assert.rejects(
        as(
          "authenticated",
          visitor,
          "insert into public.admin_users values ($1)",
          [visitor],
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "a pending request holds a time and the unique index rejects a duplicate",
    async () => {
      booking = (await request(slot))[0].id;
      await assert.rejects(
        request(slot, "other@example.test"),
        /no longer available/,
      );
      assert.equal((await calendar()).slots.length, 0);
      assert.equal(
        (await as("authenticated", admin, "select * from public.appointments"))
          .length,
        1,
      );
      assert.deepEqual(
        await as("authenticated", visitor, "select * from public.appointments"),
        [],
      );
      await assert.rejects(
        db.query(
          `insert into public.appointments(slot_id,customer_name,email,phone,dog_name,neighborhood) values($1,'Other','other@example.test','5550100100','Dog','Area')`,
          [slot],
        ),
        /unique constraint/,
      );
    },
  );
  await t.test(
    "approval, immutable status transitions, cancellation and rebooking",
    async () => {
      await assert.rejects(
        as(
          "authenticated",
          visitor,
          "select public.admin_review_request($1,'approved')",
          [booking],
        ),
        /Administrator access/,
      );
      await assert.rejects(
        as(
          "authenticated",
          admin,
          "update public.appointments set status = $1 where id = $2",
          ["approved", booking],
        ),
        /permission denied/,
      );
      await as(
        "authenticated",
        admin,
        "select public.admin_review_request($1,'approved')",
        [booking],
      );
      assert.equal(
        (
          await as(
            "authenticated",
            admin,
            "select status from public.appointments where id=$1",
            [booking],
          )
        )[0].status,
        "approved",
      );
      await assert.rejects(
        as(
          "authenticated",
          admin,
          "select public.admin_review_request($1,'pending')",
          [booking],
        ),
        /already changed/,
      );
      await assert.rejects(
        as("authenticated", admin, "select public.admin_set_slot($1,false)", [
          slot,
        ]),
        /active appointment/,
      );
      await assert.rejects(
        as(
          "authenticated",
          admin,
          "select public.admin_block_date(current_date+1,true)",
        ),
        /active appointments/,
      );
      await as(
        "authenticated",
        admin,
        "select public.admin_review_request($1,'cancelled')",
        [booking],
      );
      assert.equal((await calendar()).slots.length, 1);
      await assert.rejects(
        as(
          "authenticated",
          admin,
          "select public.admin_review_request($1,'approved')",
          [booking],
        ),
        /already changed/,
      );
      const next = (await request(slot))[0].id;
      await as(
        "authenticated",
        admin,
        "select public.admin_review_request($1,'declined')",
        [next],
      );
      assert.equal((await calendar()).slots.length, 1);
    },
  );
  await t.test(
    "date blocking and closing are enforced again on submission, even with a stale slot ID",
    async () => {
      await as(
        "authenticated",
        admin,
        "select public.admin_block_date(current_date+1,true)",
      );
      assert.equal((await calendar()).slots.length, 0);
      await assert.rejects(request(slot), /no longer available/);
      await assert.rejects(add(1, "17:00"), /Unblock/);
      await as(
        "authenticated",
        admin,
        "select public.admin_block_date(current_date+1,false)",
      );
      await as(
        "authenticated",
        admin,
        "select public.admin_set_slot($1,false)",
        [slot],
      );
      await assert.rejects(request(slot), /no longer available/);
      await as(
        "authenticated",
        admin,
        "select public.admin_set_slot($1,true)",
        [slot],
      );
      assert.equal((await calendar()).slots.length, 1);
    },
  );
  await t.test(
    "overlapping availability, dates outside 30 days, nulls and invalid inputs are rejected",
    async () => {
      await assert.rejects(add(1, "15:15"), /overlaps/);
      await add(1, "15:30"); // Endpoints can touch, but never overlap.
      await assert.rejects(add(30), /next 30 days/);
      await assert.rejects(add(-1), /next 30 days/);
      await assert.rejects(
        as("authenticated", admin, "select public.admin_add_slot(null,null)"),
        /valid future/,
      );
      await assert.rejects(
        as(
          "service_role",
          null,
          "select public.request_walk($1,$2,$3,$4,$5,$6,$7)",
          [slot, " ", "bad-email", "123", "Dog", "Area", ""],
        ),
        /check constraint/,
      );
      const far = (
        await db.query(
          "insert into public.walk_slots(starts_at,ends_at) values(now()+interval '31 days',now()+interval '31 days 30 minutes') returning id",
        )
      ).rows[0].id;
      assert.ok(!(await calendar()).slots.some((s) => s.id === far));
      await assert.rejects(request(far), /no longer available/);
      const past = (
        await db.query(
          "insert into public.walk_slots(starts_at,ends_at) values(now()-interval '1 day',now()-interval '1 day'+interval '30 minutes') returning id",
        )
      ).rows[0].id;
      await assert.rejects(request(past), /no longer available/);
    },
  );
  await t.test(
    "per-contact request limit is normalized and enforced by server",
    async () => {
      const a = await add(2),
        b = await add(3),
        c = await add(4),
        d = await add(5);
      await request(a, " Limit@Example.test ");
      await request(b, "limit@example.test");
      await request(c, "LIMIT@example.test");
      await assert.rejects(
        request(d, "limit@example.test"),
        /contact the team/,
      );
    },
  );
  await t.test(
    "public function execute grants have no PUBLIC or anonymous admin bypass",
    async () => {
      const rows = (
        await db.query(
          "select p.proname, has_function_privilege('anon',p.oid,'execute') as anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
        )
      ).rows;
      for (const row of rows.filter(
        (r) => r.proname.startsWith("admin_") || r.proname === "is_admin",
      ))
        assert.equal(row.anon, false, row.proname);
    },
  );
  await db.close();
});
