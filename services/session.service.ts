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

function toCanonicalJsonValue(value: unknown, fallback: unknown): unknown {
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") return parsed;
  return fallback;
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

function toCanonicalNullableJsonValue(value: unknown): unknown | null {
  if (value == null) return null;
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") return parsed;
  return null;
}

const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  { slug: "physics", name: "Physics", aliases: ["physics", "physic", "រូបវិទ្យា", "រូប វិទ្យា"] },
  { slug: "mathematics", name: "Math", aliases: ["mathematics", "math", "maths", "គណិតវិទ្យា", "គណិត វិទ្យា"] },
  { slug: "chemistry", name: "Chemistry", aliases: ["chemistry", "គីមីវិទ្យា", "គីមី វិទ្យា"] },
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

/**
 * Resolve a topic_id from the topics table using subject_id + slug.
 * Falls back to a hardcoded pattern map when the DB lookup finds no match,
 * which covers freshly-created sessions where the slug is well-known.
 */
async function resolveTopicId(subjectId: string | null, topicSlug: string | null | undefined): Promise<string | null> {
  if (!topicSlug) return null;
  const slug = String(topicSlug).trim().toLowerCase();
  if (!slug) return null;

  // ── DB lookup first: exact match on subject_id + slug ─────────────────────
  if (subjectId) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("topics")
      .select("id")
      .eq("subject_id", subjectId)
      .eq("slug", slug)
      .maybeSingle();
    if (data?.id) return String(data.id);

    // Partial slug match (e.g. "probability-stats" contains "probability")
    const { data: allTopics } = await db
      .from("topics")
      .select("id, slug")
      .eq("subject_id", subjectId);
    if (allTopics) {
      const rows = allTopics as Array<{ id: string; slug: string }>;
      const partial = rows.find((r) => slug.includes(r.slug) || r.slug.includes(slug));
      if (partial) return String(partial.id);
    }
  }

  // ── Hardcoded fallback (known canonical IDs from seed_taxonomy) ────────────
  if (slug.includes("algebra")) return "topic-math-algebra";
  if (slug.includes("geometry")) return "topic-math-geometry";
  if (slug.includes("calculus")) return "topic-math-calculus";
  if (slug.includes("probability")) return "topic-math-probability-stats";
  if (slug.includes("arithmetic")) return "topic-math-arithmetic";
  if (slug.includes("mechanic")) return "topic-physics-mechanics";
  if (slug.includes("electromagnetism")) return "topic-physics-electromagnetism";
  if (slug.includes("thermodynamics")) return "topic-physics-thermodynamics";
  if (slug.includes("optics")) return "topic-physics-optics-waves";
  if (slug.includes("modern")) return "topic-physics-modern-physics";
  if (slug.includes("organic")) return "topic-chemistry-organic-chemistry";
  if (slug.includes("inorganic")) return "topic-chemistry-inorganic-chemistry";
  if (slug.includes("biochem")) return "topic-chemistry-biochemistry";
  if (slug.includes("physical")) return "topic-chemistry-physical-chemistry";
  if (slug.includes("general")) return "topic-chemistry-general-chemistry";

  return null;
}

const MATH_ID = "017d3f2f-f212-4cf1-b522-c176b7027acf";
const PHYSICS_ID = "cc02b7ca-a34b-4010-b7e4-bffb9be2a3cb";
const CHEMISTRY_ID = "98dca07b-2f9f-4e8b-83a0-428863d1e527";
const SESSION_LIST_SELECT = "id,user_id,title,subject_id,topic_id,problem,node_count,duration_seconds,image_url,created_at";

function resolveSubjectNameFromId(subjectId: string | null | undefined): string | null {
  if (!subjectId) return null;
  if (subjectId === MATH_ID) return "Math";
  if (subjectId === PHYSICS_ID) return "Physics";
  if (subjectId === CHEMISTRY_ID) return "Chemistry";
  return null;
}

function resolveTopicSlugFromId(topicId: string): string | null {
  if (topicId.startsWith("topic-math-")) return topicId.replace("topic-math-", "");
  if (topicId.startsWith("topic-physics-")) return topicId.replace("topic-physics-", "");
  if (topicId.startsWith("topic-chemistry-")) return topicId.replace("topic-chemistry-", "");
  return null;
}

function segmentProblemText(text: string): Array<{ type: 'text' | 'math'; value: string }> {
  if (!text) return [];
  const segments: Array<{ type: 'text' | 'math'; value: string }> = [];
  const regex = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      const plainText = text.slice(lastIndex, matchIndex);
      if (plainText) {
        segments.push({ type: 'text', value: plainText });
      }
    }
    const rawMath = match[0];
    let mathVal = rawMath;
    if (rawMath.startsWith('$$') && rawMath.endsWith('$$')) {
      mathVal = rawMath.slice(2, -2);
    } else if (rawMath.startsWith('$') && rawMath.endsWith('$')) {
      mathVal = rawMath.slice(1, -1);
    }
    segments.push({ type: 'math', value: mathVal.trim() });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const plainText = text.slice(lastIndex);
    if (plainText) {
      segments.push({ type: 'text', value: plainText });
    }
  }

  return segments;
}

function parseProblemText(problemVal: unknown): string {
  if (typeof problemVal === "string") {
    if (problemVal.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(problemVal);
        return parsed.text || problemVal;
      } catch {
        return problemVal;
      }
    }
    return problemVal;
  }
  if (problemVal && typeof problemVal === "object") {
    return (problemVal as any).text || JSON.stringify(problemVal);
  }
  return "";
}

function normalizeSessionRow(row: Record<string, unknown>): StudySession {
  const subjectId = typeof row.subject_id === "string" ? row.subject_id : null;
  const resolvedSubject = resolveSubjectNameFromId(subjectId) || "General";
  const topicId = typeof row.topic_id === "string" ? row.topic_id : null;
  const topicSlug = typeof row.topic === "string" ? row.topic : (topicId ? resolveTopicSlugFromId(topicId) : null);

  const parsedText = parseProblemText(row.problem);
  let parsedJson: any = null;
  if (row.problem) {
    if (typeof row.problem === "string") {
      if (row.problem.trim().startsWith("{")) {
        try {
          parsedJson = JSON.parse(row.problem);
        } catch {
          parsedJson = { text: row.problem, segments: segmentProblemText(row.problem) };
        }
      } else {
        parsedJson = { text: row.problem, segments: segmentProblemText(row.problem) };
      }
    } else if (typeof row.problem === "object") {
      parsedJson = row.problem;
      if (!parsedJson.segments && parsedJson.text) {
        parsedJson.segments = segmentProblemText(parsedJson.text);
      }
    }
  }

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    subject: resolvedSubject,
    subject_id: subjectId,
    topic: topicSlug,
    topic_id: topicId,
    problem: parsedText,
    problem_json: parsedJson,
    node_count: Number(row.node_count ?? 0),
    duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    breakdown_json: toCanonicalJsonString(row.breakdown_json, {}),
    visual_table_json: toCanonicalNullableJsonString(row.visual_table_json),
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    created_at: String(row.created_at),
  };
}

function normalizeSubjectName(subject: string | null | undefined): string {
  const normalized = String(subject ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Map to Physics
  if (
    normalized.includes("physics") ||
    normalized.includes("physic") ||
    normalized.includes("រូបវិទ្យា") ||
    normalized.includes("រូប វិទ្យា")
  ) {
    return "Physics";
  }

  // Map to Chemistry
  if (
    normalized.includes("chemistry") ||
    normalized.includes("chemi") ||
    normalized.includes("គីមីវិទ្យា") ||
    normalized.includes("គីមី វិទ្យា")
  ) {
    return "Chemistry";
  }

  // Everything else maps to Math (Mathematics, Algebra, Calculus, Khmer math terms, sequences, etc.)
  return "Math";
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

  const breakdownVal = dto.breakdown_json as any;
  const topicSlug = dto.topic || breakdownVal?.topic || null;
  const topicId = dto.topic_id || await resolveTopicId(subjectId, topicSlug);

  const session: StudySession = {
    id: generateId(),
    user_id: userId,
    title: dto.title,
    subject,
    subject_id: subjectId,
    topic: topicSlug,
    topic_id: topicId,
    problem: dto.problem,
    node_count: dto.node_count,
    duration_seconds: dto.duration_seconds ?? null,
    breakdown_json: toCanonicalJsonString(dto.breakdown_json, {}),
    visual_table_json: toCanonicalNullableJsonString(dto.visual_table_json),
    image_url: dto.image_url ?? null,
    created_at: nowISO(),
  };

  // Exclude 'subject' (dropped column) from DB insert; 'topic' is a valid TEXT column and is kept.
  const { subject: _omitS, ...dbPayload } = session;
  const sessionForDb = {
    ...dbPayload,
    problem: toCanonicalJsonValue(
      {
        text: dto.problem,
        segments: segmentProblemText(dto.problem)
      },
      { text: "", segments: [] }
    ),
    breakdown_json: toCanonicalJsonValue(dto.breakdown_json, {}),
    visual_table_json: toCanonicalNullableJsonValue(dto.visual_table_json),
  };

  let insertPayload: any = sessionForDb;
  let { data, error } = await db
    .from("study_sessions")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    // Backward compatibility for environments where topic/topic_id columns do not exist yet.
    if (error.message.includes("column \"topic\" of relation \"study_sessions\" does not exist") || (error.message.includes("topic") && error.message.includes("does not exist"))) {
      const { topic_id: _omitTi, topic: _omitTopic, ...legacySession } = insertPayload;
      const legacyPayload = { ...legacySession };
      const { data: legacyData, error: legacyError } = await db
        .from("study_sessions")
        .insert(legacyPayload)
        .select()
        .single();
      if (legacyError) {
        if (legacyError.message.includes("visual_table_json") && legacyError.message.includes("does not exist")) {
          const { visual_table_json: _omitVt, ...sessionWithoutVt } = legacyPayload;
          const { data: vtData, error: vtError } = await db
            .from("study_sessions")
            .insert(sessionWithoutVt)
            .select()
            .single();
          if (vtError) throw new AppError(vtError.message, 500);
          const normalized = normalizeSessionRow((vtData ?? {}) as Record<string, unknown>);
          return { ...normalized, topic: null, topic_id: null, visual_table_json: session.visual_table_json ?? null };
        }
        throw new AppError(legacyError.message, 500);
      }
      const normalized = normalizeSessionRow((legacyData ?? {}) as Record<string, unknown>);
      return { ...normalized, topic: null, topic_id: null };
    }

    // Backward compatibility for environments where visual_table_json has not been added yet.
    if (error.message.includes("visual_table_json") && error.message.includes("does not exist")) {
      const { visual_table_json: _omitVt, ...sessionWithoutVt } = insertPayload;
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
      const { subject_id: _omit, ...legacySession } = insertPayload;
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

  // Strip 'subject' (dropped DB column); all other fields including 'topic' pass through.
  const { subject: _omitS, ...updatesWithoutSubject } = updates as Record<string, unknown>;
  const normalizedUpdates: Record<string, unknown> = { ...updatesWithoutSubject };
  if (Object.prototype.hasOwnProperty.call(updates, "breakdown_json")) {
    normalizedUpdates.breakdown_json = toCanonicalJsonValue(updates.breakdown_json, {});
  }
  if (Object.prototype.hasOwnProperty.call(updates, "visual_table_json")) {
    normalizedUpdates.visual_table_json = toCanonicalNullableJsonValue(updates.visual_table_json);
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
    .select(SESSION_LIST_SELECT)
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
      .select(SESSION_LIST_SELECT)
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

  // Batch-fetch chat message counts for all sessions in one query.
  const sessionIds = merged.map((s) => s.id);
  console.log("[getUserSessions] chat_count: sessionIds", sessionIds.length, sessionIds.slice(0, 3));
  if (sessionIds.length > 0) {
    const { data: chatRows, error: chatError } = await db
      .from("chat_messages")
      .select("session_id")
      .in("session_id", sessionIds);

    console.log("[getUserSessions] chat_count: chatRows", chatRows?.length ?? 0, "error:", chatError?.message ?? null);
    console.log("[getUserSessions] chat_count: sample rows", (chatRows ?? []).slice(0, 3));

    const chatCountMap = new Map<string, number>();
    for (const row of (chatRows ?? []) as Array<{ session_id: string }>) {
      chatCountMap.set(row.session_id, (chatCountMap.get(row.session_id) ?? 0) + 1);
    }
    console.log("[getUserSessions] chat_count: countMap entries", chatCountMap.size, [...chatCountMap.entries()].slice(0, 3));
    for (const s of merged) {
      s.chat_count = chatCountMap.get(s.id) ?? 0;
    }
  }

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
