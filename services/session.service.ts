import { getSupabaseAdmin } from "../config/supabase.js";
import { StudySession, CreateSessionDTO, UpdateSessionDTO } from "../models/session.model.js";
import { generateId, nowISO, slugify } from "../utils/helpers.js";
import { AppError } from "../api/middlewares/error.middleware.js";
import { canUserAccessSession, canUserEditSession } from "./collaboration.service.js";

type CanonicalSubject = {
  slug: string;
  name: string;
  aliases: string[];
};

type SubjectRow = {
  id: string;
  name: string;
  slug: string;
};

function parseJsonDeep(value: unknown, maxDepth = 3): unknown {
  let current: unknown = value;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed) return current;
    if (!/^[{\["]/.test(trimmed)) return current;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }
  return current;
}

function toCanonicalJsonString(value: unknown, fallback: unknown): string {
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") {
    try {
      return JSON.stringify(parsed);
    } catch {
      return JSON.stringify(fallback);
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        return JSON.stringify(fallback);
      }
    }
  }
  return JSON.stringify(fallback);
}

function toCanonicalNullableJsonString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") {
    try {
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  { slug: "physics", name: "Physics", aliases: ["physics", "រូបវិទ្យា", "រូប វិទ្យា"] },
  { slug: "mathematics", name: "Mathematics", aliases: ["mathematics", "math", "maths", "គណិតវិទ្យា", "គណិត វិទ្យា"] },
  { slug: "chemistry", name: "Chemistry", aliases: ["chemistry", "គីមីវិទ្យា", "គីមី វិទ្យា"] },
  { slug: "biology", name: "Biology", aliases: ["biology", "ជីវវិទ្យា", "ជីវ វិទ្យា"] },
  { slug: "history", name: "History", aliases: ["history", "ប្រវត្តិវិទ្យា", "ប្រវត្តិ វិទ្យា"] },
  { slug: "geography", name: "Geography", aliases: ["geography", "ភូមិវិទ្យា", "ភូមិ វិទ្យា"] },
  { slug: "english", name: "English", aliases: ["english", "អង់គ្លេស"] },
  { slug: "khmer", name: "Khmer", aliases: ["khmer", "ភាសាខ្មែរ"] },
];

function normalizeSubjectKey(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCanonicalSubject(input: string): CanonicalSubject | null {
  const key = normalizeSubjectKey(input);
  if (!key) return null;

  for (const subject of CANONICAL_SUBJECTS) {
    const aliasSet = new Set(subject.aliases.map((alias) => normalizeSubjectKey(alias)));
    if (aliasSet.has(key)) return subject;
  }
  return null;
}

function chooseBestSubjectMatch(candidates: SubjectRow[], canonical: CanonicalSubject | null): SubjectRow | null {
  if (!candidates.length) return null;
  if (!canonical) return candidates[0];

  const canonicalAliasSet = new Set(canonical.aliases.map((alias) => normalizeSubjectKey(alias)));
  let best: SubjectRow | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const normalizedName = normalizeSubjectKey(candidate.name);
    let score = 0;
    if (candidate.slug === canonical.slug) score += 100;
    if (slugify(candidate.name) === canonical.slug) score += 60;
    if (canonicalAliasSet.has(normalizedName)) score += 30;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best ?? candidates[0];
}

function normalizeSessionRow(row: Record<string, unknown>): StudySession {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    subject: String(row.subject ?? "General"),
    subject_id: typeof row.subject_id === "string" ? row.subject_id : null,
    problem: String(row.problem),
    node_count: Number(row.node_count ?? 0),
    duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    breakdown_json: toCanonicalJsonString(row.breakdown_json, {}),
    visual_table_json: toCanonicalNullableJsonString(row.visual_table_json),
    created_at: String(row.created_at),
  };
}

function normalizeSubjectName(subject: string | null | undefined): string {
  const normalized = String(subject ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "General";

  // Handle compound subjects like "Calculus, Physics" or "Physics & Math"
  // Prefer the first part that maps to a canonical subject; otherwise use the first part.
  const separatorPattern = /[,&\/|+]/;
  if (separatorPattern.test(normalized)) {
    const parts = normalized.split(separatorPattern).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const canonical = detectCanonicalSubject(part);
      if (canonical) return canonical.name;
    }
    return parts[0] || "General";
  }

  return normalized;
}

function deterministicSlug(text: string): string {
  // Deterministic fallback slug for non-Latin text (e.g. Khmer) where slugify() returns "".
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `subject-${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

export async function resolveOrCreateSubjectId(rawSubject: string): Promise<string> {
  const db = getSupabaseAdmin();
  const subjectName = normalizeSubjectName(rawSubject);
  const canonical = detectCanonicalSubject(subjectName);
  const subjectSlug =
    canonical?.slug ?? (slugify(subjectName) || deterministicSlug(subjectName));
  const subjectDisplayName = canonical?.name ?? subjectName;
  const normalizedInput = normalizeSubjectKey(subjectName);

  const { data: allSubjects, error: listError } = await db
    .from("subjects")
    .select("id, name, slug")
    .limit(1000);
  if (listError) throw new AppError(listError.message, 500);

  const rows = ((allSubjects ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      slug: String(row.slug ?? ""),
    }))
    .filter((row) => row.id && row.name);

  if (subjectSlug) {
    const bySlug = rows.find((row) => row.slug === subjectSlug);
    if (bySlug) return bySlug.id;
  }

  if (canonical) {
    const canonicalAliasSet = new Set(canonical.aliases.map((alias) => normalizeSubjectKey(alias)));
    const aliasMatches = rows.filter((row) => canonicalAliasSet.has(normalizeSubjectKey(row.name)));
    const bestAliasMatch = chooseBestSubjectMatch(aliasMatches, canonical);
    if (bestAliasMatch) return bestAliasMatch.id;
  }

  const exactName = rows.find((row) => normalizeSubjectKey(row.name) === normalizedInput);
  if (exactName) return exactName.id;

  if (subjectSlug) {
    const { data: upsertedSubject, error: upsertError } = await db
      .from("subjects")
      .upsert(
        {
          id: generateId(),
          name: subjectDisplayName,
          slug: subjectSlug,
          created_at: nowISO(),
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();

    if (upsertError) throw new AppError(upsertError.message, 500);
    return String(upsertedSubject.id);
  }

  const { data: existingByName, error: nameLookupError } = await db
    .from("subjects")
    .select("id")
    .eq("name", subjectName)
    .maybeSingle();

  if (nameLookupError) throw new AppError(nameLookupError.message, 500);
  if (existingByName?.id) return String(existingByName.id);

  const { data: insertedSubject, error: insertError } = await db
    .from("subjects")
    .insert({
      id: generateId(),
      name: subjectDisplayName,
      slug: `subject-${generateId().slice(0, 8)}`,
      created_at: nowISO(),
    })
    .select("id")
    .single();

  if (insertError) throw new AppError(insertError.message, 500);
  return String(insertedSubject.id);
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSession(userId: string, dto: CreateSessionDTO): Promise<StudySession> {
  const db = getSupabaseAdmin();
  const subject = normalizeSubjectName(dto.subject);
  const subjectId = dto.subject_id ?? (await resolveOrCreateSubjectId(subject));

  const session: StudySession = {
    id: generateId(),
    user_id: userId,
    title: dto.title,
    subject,
    subject_id: subjectId,
    problem: dto.problem,
    node_count: dto.node_count,
    duration_seconds: dto.duration_seconds ?? null,
    breakdown_json: toCanonicalJsonString(dto.breakdown_json, {}),
    visual_table_json: toCanonicalNullableJsonString(dto.visual_table_json),
    created_at: nowISO(),
  };

  const { data, error } = await db
    .from("study_sessions")
    .insert(session)
    .select()
    .single();

  if (error) {
    // Backward compatibility for environments where visual_table_json has not been added yet.
    if (error.message.includes("visual_table_json") && error.message.includes("does not exist")) {
      const { visual_table_json: _omitVt, ...sessionWithoutVt } = session;
      const { data: vtData, error: vtError } = await db
        .from("study_sessions")
        .insert(sessionWithoutVt)
        .select()
        .single();
      if (vtError) throw new AppError(vtError.message, 500);
      const normalized = normalizeSessionRow((vtData ?? {}) as Record<string, unknown>);
      return { ...normalized, visual_table_json: session.visual_table_json ?? null };
    }
    // Backward compatibility for environments where subject_id has not been added yet.
    if (error.message.includes("subject_id") && error.message.includes("does not exist")) {
      const { subject_id: _omit, ...legacySession } = session;
      const { data: legacyData, error: legacyError } = await db
        .from("study_sessions")
        .insert(legacySession)
        .select()
        .single();
      if (legacyError) throw new AppError(legacyError.message, 500);
      const normalized = normalizeSessionRow((legacyData ?? {}) as Record<string, unknown>);
      return { ...normalized, subject_id: subjectId };
    }
    throw new AppError(error.message, 500);
  }

  return normalizeSessionRow((data ?? {}) as Record<string, unknown>);
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateSession(id: string, userId: string, updates: UpdateSessionDTO): Promise<StudySession> {
  const db = getSupabaseAdmin();

  const canEdit = await canUserEditSession(id, userId);
  if (!canEdit) throw new AppError("Forbidden", 403);

  const normalizedUpdates: UpdateSessionDTO = { ...updates };
  if (Object.prototype.hasOwnProperty.call(updates, "breakdown_json")) {
    normalizedUpdates.breakdown_json = toCanonicalJsonString(updates.breakdown_json, {});
  }
  if (Object.prototype.hasOwnProperty.call(updates, "visual_table_json")) {
    normalizedUpdates.visual_table_json = toCanonicalNullableJsonString(updates.visual_table_json);
  }

  const { data, error } = await db
    .from("study_sessions")
    .update(normalizedUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return normalizeSessionRow((data ?? {}) as Record<string, unknown>);
}

export async function getUserSessions(userId: string): Promise<(StudySession & { user_role: 'owner' | 'editor' | 'viewer' })[]> {
  const db = getSupabaseAdmin();

  // Owned sessions
  const { data: ownedData, error: ownedError } = await db
    .from("study_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (ownedError) throw new AppError(ownedError.message, 500);

  // Sessions where the user is a member (editor/viewer)
  const { data: memberRows } = await db
    .from("session_members")
    .select("session_id, role")
    .eq("user_id", userId);

  let sharedSessions: (StudySession & { user_role: 'owner' | 'editor' | 'viewer' })[] = [];

  if (memberRows && memberRows.length > 0) {
    const sharedIds = (memberRows as Array<{ session_id: string; role: string }>).map((m) => m.session_id);

    const { data: sharedData } = await db
      .from("study_sessions")
      .select("*")
      .in("id", sharedIds)
      .order("created_at", { ascending: false });

    if (sharedData) {
      const roleBySessionId = new Map(
        (memberRows as Array<{ session_id: string; role: string }>).map((m) => [m.session_id, m.role as 'editor' | 'viewer'])
      );
      sharedSessions = (sharedData as Record<string, unknown>[]).map((row) => ({
        ...normalizeSessionRow(row),
        user_role: roleBySessionId.get(String(row.id)) ?? 'viewer',
      }));
    }
  }

  const ownedSessions = ((ownedData ?? []) as Record<string, unknown>[]).map((row) => ({
    ...normalizeSessionRow(row),
    user_role: 'owner' as const,
  }));

  // Merge: owned first, then shared. Deduplicate by session ID.
  const seen = new Set<string>();
  const merged: (StudySession & { user_role: 'owner' | 'editor' | 'viewer' })[] = [];
  for (const s of [...ownedSessions, ...sharedSessions]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  // Sort by created_at descending
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return merged;
}

export async function deleteSession(id: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();

  const { error } = await db
    .from("study_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new AppError(error.message, 500);
}

export async function getSessionById(id: string, userId: string): Promise<StudySession | null> {
  const db = getSupabaseAdmin();

  const canAccess = await canUserAccessSession(id, userId);
  if (!canAccess) return null;

  const { data, error } = await db
    .from("study_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return normalizeSessionRow((data ?? {}) as Record<string, unknown>);
}
