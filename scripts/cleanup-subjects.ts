/**
 * One-off script: merge duplicate/inconsistent subject rows.
 *
 * Run from the zupiq-backend directory:
 *   npx tsx scripts/cleanup-subjects.ts
 *
 * What it does:
 *  1. Fetches every subject row.
 *  2. Flags "dirty" subjects:
 *     - Compound names  → "Calculus, Physics", "Physics & Math", etc.
 *     - Random-slug rows → slug matches /^subject-[0-9a-f]{8}$/
 *  3. For each dirty subject, resolves the canonical target:
 *     - Splits compound name, tries each part against canonical list.
 *     - Falls back to the first part as a plain name match.
 *  4. Finds (or creates) the clean target subject in the DB.
 *  5. Re-points every study_session that uses the dirty subject_id → target.
 *  6. Deletes the dirty subject row.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ─── Env setup ────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.development") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Canonical subjects (mirrors session.service.ts) ─────────────────────────
type CanonicalSubject = { slug: string; name: string; aliases: string[] };

const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  { slug: "physics",     name: "Physics",     aliases: ["physics", "រូបវិទ្យា", "រូប វិទ្យា"] },
  { slug: "mathematics", name: "Mathematics", aliases: ["mathematics", "math", "maths", "គណិតវិទ្យា", "គណិត វិទ្យា"] },
  { slug: "chemistry",   name: "Chemistry",   aliases: ["chemistry", "គីមីវិទ្យា", "គីមី វិទ្យា"] },
  { slug: "biology",     name: "Biology",     aliases: ["biology", "ជីវវិទ្យា", "ជីវ វិទ្យា"] },
  { slug: "history",     name: "History",     aliases: ["history", "ប្រវត្តិវិទ្យា", "ប្រវត្តិ វិទ្យា"] },
  { slug: "geography",   name: "Geography",   aliases: ["geography", "ភូមិវិទ្យា", "ភូមិ វិទ្យា"] },
  { slug: "english",     name: "English",     aliases: ["english", "អង់គ្លេស"] },
  { slug: "khmer",       name: "Khmer",       aliases: ["khmer", "ភាសាខ្មែរ"] },
  { slug: "calculus",    name: "Calculus",    aliases: ["calculus"] },
  { slug: "algebra",     name: "Algebra",     aliases: ["algebra"] },
  { slug: "general",     name: "General",     aliases: ["general"] },
];

function normalizeKey(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function detectCanonical(input: string): CanonicalSubject | null {
  const key = normalizeKey(input);
  if (!key) return null;
  for (const s of CANONICAL_SUBJECTS) {
    const aliasSet = new Set(s.aliases.map(normalizeKey));
    if (aliasSet.has(key)) return s;
  }
  return null;
}

const SEPARATOR = /[,&\/|+]/;
const RANDOM_SLUG_RE = /^subject-[0-9a-f]{8}$/;

type SubjectRow = { id: string; name: string; slug: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveTargetName(dirtyName: string): { name: string; slug: string } {
  // 1. Try to detect canonical subject directly
  const direct = detectCanonical(dirtyName);
  if (direct) return { name: direct.name, slug: direct.slug };

  // 2. Compound subject — split and try each part
  if (SEPARATOR.test(dirtyName)) {
    const parts = dirtyName.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const c = detectCanonical(part);
      if (c) return { name: c.name, slug: c.slug };
    }
    // No canonical part — use the first part as-is
    const first = parts[0];
    return { name: first, slug: slugify(first) || `subject-${hashSlug(first)}` };
  }

  // 3. Random-slug: the subject name itself might be fine; just fix slug
  const s = slugify(dirtyName);
  return { name: dirtyName, slug: s || `subject-${hashSlug(dirtyName)}` };
}

function hashSlug(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

async function findOrCreateSubject(
  allRows: SubjectRow[],
  targetName: string,
  targetSlug: string
): Promise<string> {
  // Prefer exact slug match
  const bySlug = allRows.find((r) => r.slug === targetSlug);
  if (bySlug) return bySlug.id;

  // Prefer exact name match (normalized)
  const targetKey = normalizeKey(targetName);
  const byName = allRows.find((r) => normalizeKey(r.name) === targetKey);
  if (byName) return byName.id;

  // Create it
  const newId = crypto.randomUUID();
  const { error } = await db.from("subjects").insert({
    id: newId,
    name: targetName,
    slug: targetSlug,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to create subject "${targetName}": ${error.message}`);

  console.log(`  ✦ Created new subject: "${targetName}" (${targetSlug})`);
  allRows.push({ id: newId, name: targetName, slug: targetSlug }); // keep local list in sync
  return newId;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching all subjects...");
  const { data: subjectData, error: subjectError } = await db
    .from("subjects")
    .select("id, name, slug")
    .order("created_at", { ascending: true });

  if (subjectError) throw new Error(subjectError.message);
  const allRows: SubjectRow[] = (subjectData ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    slug: String(r.slug ?? ""),
  }));

  console.log(`Found ${allRows.length} subjects total.\n`);

  // Identify dirty rows
  const dirty = allRows.filter(
    (r) => SEPARATOR.test(r.name) || RANDOM_SLUG_RE.test(r.slug)
  );

  if (!dirty.length) {
    console.log("No dirty subjects found. Nothing to do.");
    return;
  }

  console.log(`Found ${dirty.length} dirty subject(s):\n`);

  for (const row of dirty) {
    console.log(`Processing: "${row.name}" (slug: ${row.slug}, id: ${row.id})`);

    const { name: targetName, slug: targetSlug } = resolveTargetName(row.name);
    console.log(`  → Target: "${targetName}" (slug: ${targetSlug})`);

    // Get or create the target subject
    const targetId = await findOrCreateSubject(allRows, targetName, targetSlug);

    if (targetId === row.id) {
      console.log(`  ✓ Already the canonical row — skipping.\n`);
      continue;
    }

    // Re-point sessions
    const { data: sessions, error: sessError } = await db
      .from("study_sessions")
      .select("id")
      .eq("subject_id", row.id);

    if (sessError) throw new Error(sessError.message);
    const sessionIds = ((sessions ?? []) as Array<{ id: string }>).map((s) => s.id);

    if (sessionIds.length > 0) {
      const { error: updateError } = await db
        .from("study_sessions")
        .update({ subject_id: targetId })
        .eq("subject_id", row.id);
      if (updateError) throw new Error(`Failed to update sessions: ${updateError.message}`);
      console.log(`  ✓ Re-pointed ${sessionIds.length} session(s) → "${targetName}"`);
    } else {
      console.log(`  ✓ No sessions referenced this subject.`);
    }

    // Delete the dirty subject
    const { error: deleteError } = await db.from("subjects").delete().eq("id", row.id);
    if (deleteError) throw new Error(`Failed to delete subject: ${deleteError.message}`);
    console.log(`  ✓ Deleted dirty subject "${row.name}"\n`);
  }

  console.log("Done. Cleanup complete.");
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
