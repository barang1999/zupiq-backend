import { Router, Request, Response, NextFunction } from "express";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { requireAuth, optionalAuth } from "../middlewares/auth.middleware.js";
import { ValidationError, NotFoundError } from "../middlewares/error.middleware.js";
import { generateId, slugify, nowISO } from "../../utils/helpers.js";
import type { Subject, Topic, Lesson, CreateSubjectDTO, CreateTopicDTO, CreateLessonDTO, UpdateLessonDTO } from "../../models/subject.model.js";

const router = Router();

function relationCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || value.length === 0) return 0;
  const count = (value[0] as { count?: unknown })?.count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

// ─── Subjects ─────────────────────────────────────────────────────────────────

// GET /api/subjects
router.get("/", optionalAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const { data: subjects, error } = await db
      .from("subjects")
      .select("*, topics(count)")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    const normalized = ((subjects ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      description: (row.description as string | null) ?? null,
      icon: (row.icon as string | null) ?? null,
      color: (row.color as string | null) ?? null,
      topic_count: relationCount(row.topics),
      created_at: String(row.created_at),
    })) as Subject[];
    res.json({ subjects: normalized });
  } catch (err) {
    next(err);
  }
});

// GET /api/subjects/:slug
router.get("/:slug", optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const { data: subject } = await db
      .from("subjects")
      .select("*")
      .or(`slug.eq.${req.params.slug},id.eq.${req.params.slug}`)
      .single();
    if (!subject) throw new NotFoundError("Subject");
    res.json({ subject });
  } catch (err) {
    next(err);
  }
});

// POST /api/subjects
router.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, icon, color } = req.body as CreateSubjectDTO;
    if (!name) throw new ValidationError("name is required");

    const db = getSupabaseAdmin();
    const { data: subject, error } = await db
      .from("subjects")
      .insert({ id: generateId(), name, slug: slugify(name), description, icon, color, created_at: nowISO() })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({ subject });
  } catch (err) {
    next(err);
  }
});

// ─── Topics ───────────────────────────────────────────────────────────────────

// GET /api/subjects/:subjectId/topics
router.get("/:subjectId/topics", optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const { data: subject } = await db
      .from("subjects")
      .select("id")
      .or(`id.eq.${req.params.subjectId},slug.eq.${req.params.subjectId}`)
      .single();
    if (!subject) throw new NotFoundError("Subject");

    const { data: topics, error } = await db
      .from("topics")
      .select("*, lessons(count)")
      .eq("subject_id", subject.id)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    const normalized = ((topics ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      subject_id: String(row.subject_id),
      name: String(row.name),
      slug: String(row.slug),
      description: (row.description as string | null) ?? null,
      order_index: Number(row.order_index ?? 0),
      lesson_count: relationCount(row.lessons),
      created_at: String(row.created_at),
    })) as Topic[];
    res.json({ topics: normalized });
  } catch (err) {
    next(err);
  }
});

// POST /api/subjects/:subjectId/topics
router.post("/:subjectId/topics", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, order_index } = req.body as CreateTopicDTO;
    if (!name) throw new ValidationError("name is required");

    const db = getSupabaseAdmin();
    const { data: subject } = await db.from("subjects").select("id").eq("id", req.params.subjectId).single();
    if (!subject) throw new NotFoundError("Subject");

    const { data: topic, error } = await db
      .from("topics")
      .insert({ id: generateId(), subject_id: subject.id, name, slug: slugify(name), description, order_index: order_index ?? 0, created_at: nowISO() })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({ topic });
  } catch (err) {
    next(err);
  }
});

// ─── Lessons ──────────────────────────────────────────────────────────────────

// GET /api/subjects/topics/:topicId/lessons
router.get("/topics/:topicId/lessons", optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const { data: lessons, error } = await db
      .from("lessons")
      .select("*")
      .eq("topic_id", req.params.topicId)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ lessons });
  } catch (err) {
    next(err);
  }
});

// GET /api/subjects/lessons/:lessonId
router.get("/lessons/:lessonId", optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const { data: lesson } = await db
      .from("lessons")
      .select("*, topics(name, subjects(name))")
      .eq("id", req.params.lessonId)
      .single();
    if (!lesson) throw new NotFoundError("Lesson");
    res.json({ lesson });
  } catch (err) {
    next(err);
  }
});

// POST /api/subjects/topics/:topicId/lessons
router.post("/topics/:topicId/lessons", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content, difficulty, order_index } = req.body as CreateLessonDTO;
    if (!title) throw new ValidationError("title is required");

    const db = getSupabaseAdmin();
    const { data: topic } = await db.from("topics").select("id").eq("id", req.params.topicId).single();
    if (!topic) throw new NotFoundError("Topic");

    const { data: lesson, error } = await db
      .from("lessons")
      .insert({ id: generateId(), topic_id: topic.id, title, content, difficulty: difficulty ?? "beginner", order_index: order_index ?? 0, created_at: nowISO(), updated_at: nowISO() })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({ lesson });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/subjects/lessons/:lessonId
router.patch("/lessons/:lessonId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content, difficulty, order_index } = req.body as UpdateLessonDTO;
    const db = getSupabaseAdmin();

    const { data: existing } = await db.from("lessons").select("*").eq("id", req.params.lessonId).single();
    if (!existing) throw new NotFoundError("Lesson");

    const { data: lesson, error } = await db
      .from("lessons")
      .update({ title: title ?? existing.title, content: content ?? existing.content, difficulty: difficulty ?? existing.difficulty, order_index: order_index ?? existing.order_index, updated_at: nowISO() })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json({ lesson });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/subjects/lessons/:lessonId
router.delete("/lessons/:lessonId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const { data: lesson } = await db.from("lessons").select("id").eq("id", req.params.lessonId).single();
    if (!lesson) throw new NotFoundError("Lesson");
    await db.from("lessons").delete().eq("id", lesson.id);
    res.json({ message: "Lesson deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
