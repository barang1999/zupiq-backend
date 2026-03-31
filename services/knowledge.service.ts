import { getSupabaseAdmin } from "../config/supabase.js";
import { generateId, nowISO } from "../utils/helpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KnowledgeContentType =
  | "insight"
  | "visual_table"
  | "conversation_message"
  | "node_breakdown";

export interface KnowledgeRecord {
  id: string;
  user_id: string;
  title: string;
  content_type: KnowledgeContentType;
  subject: string | null;
  node_label: string | null;
  content: Record<string, unknown>;
  summary: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeRecordInput {
  title: string;
  content_type: KnowledgeContentType;
  subject?: string | null;
  node_label?: string | null;
  content: Record<string, unknown>;
  summary?: string | null;
  tags?: string[];
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createKnowledgeRecord(
  userId: string,
  input: CreateKnowledgeRecordInput
): Promise<KnowledgeRecord> {
  const db = getSupabaseAdmin();
  const id = generateId();
  const now = nowISO();

  const { data, error } = await db
    .from("knowledge_records")
    .insert({
      id,
      user_id: userId,
      title: input.title,
      content_type: input.content_type,
      subject: input.subject ?? null,
      node_label: input.node_label ?? null,
      content: input.content,
      summary: input.summary ?? null,
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as KnowledgeRecord;
}

export async function listKnowledgeRecords(
  userId: string,
  options: { subject?: string; limit?: number; offset?: number } = {}
): Promise<{ records: KnowledgeRecord[]; total: number }> {
  const db = getSupabaseAdmin();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  let query = db
    .from("knowledge_records")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.subject) {
    query = query.eq("subject", options.subject);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { records: (data ?? []) as KnowledgeRecord[], total: count ?? 0 };
}

export async function deleteKnowledgeRecord(
  userId: string,
  recordId: string
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("knowledge_records")
    .delete()
    .eq("id", recordId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── AI Context Builder ───────────────────────────────────────────────────────

/**
 * Fetches the user's recent saved knowledge records and formats them as a
 * compact context string. Injected into the AI system instruction so the model
 * can personalise responses, avoid re-explaining saved concepts, and match the
 * formatting patterns the user has already validated.
 *
 * Returns null when the user has no saved records (avoids bloating the prompt).
 */
export async function buildUserKnowledgeContext(
  userId: string,
  subject?: string | null
): Promise<string | null> {
  const db = getSupabaseAdmin();

  // Fetch most recent records — prefer subject-specific ones first
  let query = db
    .from("knowledge_records")
    .select("title, content_type, subject, node_label, summary, content, tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (subject) {
    query = query.eq("subject", subject);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  const lines: string[] = [
    `The student has saved ${data.length} knowledge record(s) to their personal knowledge store.`,
    `Use this context to personalise your responses: build on what they already know, avoid`,
    `re-explaining saved concepts unless explicitly asked, and match their preferred format.`,
    ``,
    `=== Student's Saved Knowledge ===`,
  ];

  for (const rec of data as Array<Record<string, unknown>>) {
    const subjectTag = rec.subject ? `[${rec.subject}] ` : "";
    lines.push(`\n• ${subjectTag}${rec.title} (${rec.content_type})`);

    if (rec.summary) {
      lines.push(`  Summary: ${String(rec.summary).slice(0, 300)}`);
    }

    const c = rec.content as Record<string, unknown>;
    switch (rec.content_type) {
      case "insight":
        if (c.simpleBreakdown) {
          lines.push(`  Breakdown: ${String(c.simpleBreakdown).slice(0, 220)}`);
        }
        if (c.keyFormula) {
          lines.push(`  Key formula: ${String(c.keyFormula).slice(0, 120)}`);
        }
        break;
      case "conversation_message":
        if (c.question) lines.push(`  Q: ${String(c.question).slice(0, 160)}`);
        if (c.answer)   lines.push(`  A: ${String(c.answer).slice(0, 220)}`);
        break;
      case "visual_table":
        lines.push(`  Saved a ${c.type === "sign_analysis" ? "sign-analysis table" : "data table"} for: ${rec.node_label ?? rec.title}`);
        break;
      case "node_breakdown":
        if (c.description) lines.push(`  Description: ${String(c.description).slice(0, 220)}`);
        if (c.mathContent)  lines.push(`  Math: ${String(c.mathContent).slice(0, 120)}`);
        break;
    }
  }

  lines.push(`\n=== End of Saved Knowledge ===`);
  return lines.join("\n");
}
