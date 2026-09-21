/**
 * One-off backfill: populate progression cache columns on the users table.
 *
 * Run from the zupiq-backend directory:
 *   npx tsx scripts/backfill-progression-cache.ts
 *
 * What it does:
 *  1. Fetches all user IDs.
 *  2. For each user, fetches their session created_at timestamps (ascending).
 *  3. Computes current_streak, last_studied_date, unique_study_days_count,
 *     first_session_date using the same logic as updateUserProgressionCache.
 *  4. Writes the result back to the users row.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.development") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeProgression(dates: string[]): {
  current_streak: number;
  last_studied_date: string | null;
  unique_study_days_count: number;
  first_session_date: string | null;
} {
  if (dates.length === 0) {
    return {
      current_streak: 0,
      last_studied_date: null,
      unique_study_days_count: 0,
      first_session_date: null,
    };
  }

  const uniqueDays = new Set(dates.map(d => d.split('T')[0]));
  const sortedDays = [...uniqueDays].sort();

  const firstSessionDate = sortedDays[0];
  const lastStudiedDate = sortedDays[sortedDays.length - 1];
  const uniqueStudyDaysCount = uniqueDays.size;

  // Compute current streak: walk backwards from today/yesterday
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterdayUtc = new Date(now);
  yesterdayUtc.setUTCDate(now.getUTCDate() - 1);
  const yesterdayStr = yesterdayUtc.toISOString().split('T')[0];

  let currentStreak = 0;
  let anchor: Date | null = null;

  if (uniqueDays.has(todayStr)) {
    currentStreak = 1;
    anchor = new Date(now);
    anchor.setUTCDate(now.getUTCDate() - 1);
  } else if (uniqueDays.has(yesterdayStr)) {
    currentStreak = 1;
    anchor = new Date(yesterdayUtc);
    anchor.setUTCDate(yesterdayUtc.getUTCDate() - 1);
  }

  while (anchor) {
    const dateStr = anchor.toISOString().split('T')[0];
    if (uniqueDays.has(dateStr)) {
      currentStreak++;
      anchor.setUTCDate(anchor.getUTCDate() - 1);
    } else {
      break;
    }
  }

  return {
    current_streak: currentStreak,
    last_studied_date: lastStudiedDate,
    unique_study_days_count: uniqueStudyDaysCount,
    first_session_date: firstSessionDate,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch all user IDs
  const { data: users, error: usersErr } = await db
    .from('users')
    .select('id');

  if (usersErr) {
    console.error('Failed to fetch users:', usersErr.message);
    process.exit(1);
  }

  console.log(`Found ${users.length} users. Starting backfill...`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    // 2. Fetch all session dates for this user
    const { data: sessions, error: sessErr } = await db
      .from('study_sessions')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (sessErr) {
      console.error(`  [${user.id}] failed to fetch sessions:`, sessErr.message);
      failed++;
      continue;
    }

    const dates = (sessions ?? []).map((s: { created_at: string }) => s.created_at);

    if (dates.length === 0) {
      skipped++;
      continue;
    }

    // 3. Compute progression values
    const progression = computeProgression(dates);

    // 4. Write back to users row
    const { error: updateErr } = await db
      .from('users')
      .update(progression)
      .eq('id', user.id);

    if (updateErr) {
      console.error(`  [${user.id}] failed to update:`, updateErr.message);
      failed++;
      continue;
    }

    console.log(
      `  [${user.id}] streak=${progression.current_streak}  ` +
      `days=${progression.unique_study_days_count}  ` +
      `last=${progression.last_studied_date}  ` +
      `first=${progression.first_session_date}`
    );
    updated++;
  }

  console.log(`\nDone. updated=${updated}  skipped=${skipped}  failed=${failed}`);
}

main().catch(e => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
