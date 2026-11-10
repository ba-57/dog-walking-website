// Public browser builds may contain only a Supabase publishable or legacy anon key.
export function validatePublicConfig(url, key) {
  if (!url && !key) return false;
  if (!url || !key)
    throw new Error("Set both public Supabase environment variables.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Supabase URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Supabase URL must be a valid HTTPS URL.");
  if (key.startsWith("sb_publishable_")) return true;
  let role;
  try {
    role = JSON.parse(
      atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ).role;
  } catch {
    /* Reject unknown key formats. */
  }
  if (role !== "anon")
    throw new Error(
      "Use only a Supabase publishable or legacy anon key. Secret and service-role keys must never be used in this website.",
    );
  return true;
}
