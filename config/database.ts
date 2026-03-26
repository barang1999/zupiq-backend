import { getSupabaseAdmin } from "./supabase.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Supabase Postgres DB wrapper ─────────────────────────────────────────────
// Returns the Supabase admin client for all server-side DB operations.
// Use: const db = getDb(); then db.from('table').select/insert/update/delete

export function getDb(): SupabaseClient {
  return getSupabaseAdmin();
}
