/**
 * One-time backfill: run level detection for all users who have sessions
 * but no detected_level yet.
 *
 * Run: npx tsx scripts/backfill-levels.ts
 */

import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.development' });

import { getSupabaseAdmin } from '../config/supabase.js';
import { detectAndUpdateLevel } from '../services/level-detection.service.js';

async function main() {
  const db = getSupabaseAdmin();

  // Fetch all users with sessions but no detected_level
  const { data: sessions, error } = await db
    .from('study_sessions')
    .select('user_id, problem, subject, topic')
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to fetch sessions:', error); process.exit(1); }

  // Group by user_id — concatenate all problem texts
  const byUser = new Map<string, string[]>();
  for (const s of sessions ?? []) {
    const text = [
      typeof s.problem === 'string' ? JSON.parse(s.problem)?.text ?? s.problem : '',
      s.subject,
      s.topic,
    ].filter(Boolean).join(' ');
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id)!.push(text);
  }

  console.log(`Processing ${byUser.size} users...`);

  for (const [userId, texts] of byUser) {
    const combined = texts.join(' ').slice(0, 2000);
    await detectAndUpdateLevel(userId, combined);
    console.log(`✓ user=${userId}`);
  }

  console.log('Done.');
}

main().catch(console.error);
