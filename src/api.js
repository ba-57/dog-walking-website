import { createClient } from "@supabase/supabase-js";
export function createApi(url, key) {
  if (!url || !key) return null;
  const client = createClient(url, key, {
    // Keep the admin session scoped to this tab, not persisted indefinitely.
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const unwrap = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const allRows = async (query) => {
    const rows = [];
    for (let start = 0; ; start += 500) {
      const page = unwrap(await query().range(start, start + 499));
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  };
  return {
    calendar: async () => unwrap(await client.rpc("get_public_calendar")),
    request: async (fields, token) => {
      const { data, error } = await client.functions.invoke("request-walk", {
        body: { fields, token },
      });
      if (error) {
        let detail;
        try {
          detail = await error.context?.json();
        } catch {
          /* Use the safe fallback. */
        }
        throw new Error(
          detail?.error ||
            "We couldn’t submit your request. Please refresh and try again.",
        );
      }
      if (!data?.id)
        throw new Error(
          "We couldn’t confirm receipt. Please wait for the team to contact you before resubmitting.",
        );
      return data.id;
    },
    session: async () => unwrap(await client.auth.getSession())?.session,
    signIn: async (email, password) =>
      unwrap(await client.auth.signInWithPassword({ email, password })),
    signOut: async () => unwrap(await client.auth.signOut({ scope: "local" })),
    isAdmin: async () => unwrap(await client.rpc("is_admin")),
    onAuthChange: (callback) =>
      client.auth.onAuthStateChange((_event, session) => callback(session)).data
        .subscription,
    adminData: async () => {
      const responses = await Promise.all([
        allRows(() =>
          client
            .from("appointments")
            .select(
              "id,slot_id,customer_name,email,phone,dog_name,neighborhood,notes,status,created_at",
            )
            .order("created_at", { ascending: false })
            .order("id"),
        ),
        allRows(() =>
          client
            .from("walk_slots")
            .select("id,starts_at,ends_at,is_open")
            .order("starts_at")
            .order("id"),
        ),
        allRows(() => client.from("blocked_dates").select("day").order("day")),
      ]);
      return {
        requests: responses[0],
        slots: responses[1],
        blocks: responses[2],
      };
    },
    addSlot: async (day, time) =>
      unwrap(await client.rpc("admin_add_slot", { p_day: day, p_time: time })),
    setSlot: async (id, isOpen) =>
      unwrap(
        await client.rpc("admin_set_slot", {
          p_slot_id: id,
          p_is_open: isOpen,
        }),
      ),
    blockDate: async (day, blocked) =>
      unwrap(
        await client.rpc("admin_block_date", {
          p_day: day,
          p_blocked: blocked,
        }),
      ),
    review: async (id, status) => {
      // Cancellations retain their existing manual-contact workflow.
      if (status === "cancelled")
        return unwrap(await client.rpc("admin_review_request", {
          p_id: id, p_status: status,
        }));
      const { data, error } = await client.functions.invoke("review-walk", {
        body: { id, status },
      });
      if (error) {
        let detail;
        try { detail = await error.context?.json(); } catch { /* safe fallback */ }
        throw new Error(detail?.error ||
          "The request may have changed. Refresh the dashboard before trying again.");
      }
      if (!data?.updated) throw new Error("Review result uncertain. Refresh the dashboard.");
      return data;
    },
  };
}
