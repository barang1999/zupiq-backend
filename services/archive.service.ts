import { getSupabaseAdmin } from "../config/supabase.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../api/middlewares/error.middleware.js";
import type {
  ArchiveCollection,
  ArchiveItem,
  ArchiveItemNote,
  ArchiveItemType,
  ArchiveSort,
  SaveArchiveItemInput,
} from "../models/archive.model.js";

const COLLECTION_SELECT = "id,user_id,name,description,icon,color,visibility,is_system,created_at,updated_at";
const ITEM_LIST_SELECT = "id,user_id,type,source_type,source_id,title,preview,asset_url,metadata,last_saved_at,last_viewed_at,created_at,updated_at";
const ITEM_DETAIL_SELECT = `${ITEM_LIST_SELECT},source_snapshot`;
const COLLECTION_COLORS = new Set(["#2563FF", "#F06292", "#52B788", "#F59E0B", "#8B5CF6", "#94A3B8"]);
const DEFAULT_COLOR = "#2563FF";

type CollectionRow = Omit<ArchiveCollection, "item_count"> & {
  archive_collection_items?: Array<{ count: number }>;
};

function operational(message: string, statusCode = 500): AppError {
  return new AppError(message, statusCode);
}

function duplicateCollectionError(): AppError {
  return new AppError("A collection with this name already exists.", 409);
}

function normalizeCollection(row: CollectionRow, itemCount?: number): ArchiveCollection {
  return {
    ...row,
    item_count: itemCount ?? Number(row.archive_collection_items?.[0]?.count ?? 0),
  };
}

function cleanSearchTerm(value?: string): string {
  return (value ?? "")
    .trim()
    .replace(/[,%().]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function cleanMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 2_000_000) throw new ValidationError("Archive metadata is too large.");
  return value as Record<string, unknown>;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function ensureSavedCollection(userId: string): Promise<ArchiveCollection> {
  const db = getSupabaseAdmin();
  const existing = await db
    .from("archive_collections")
    .select(COLLECTION_SELECT)
    .eq("user_id", userId)
    .eq("is_system", true)
    .maybeSingle();
  if (existing.error) throw operational(existing.error.message);
  if (existing.data) return normalizeCollection(existing.data as CollectionRow);

  const inserted = await db
    .from("archive_collections")
    .insert({ user_id: userId, name: "Saved", color: DEFAULT_COLOR, is_system: true })
    .select(COLLECTION_SELECT)
    .single();
  if (!inserted.error && inserted.data) return normalizeCollection(inserted.data as CollectionRow);

  // A concurrent request may have created the system collection first.
  if (inserted.error?.code === "23505") {
    const retried = await db
      .from("archive_collections")
      .select(COLLECTION_SELECT)
      .eq("user_id", userId)
      .eq("is_system", true)
      .single();
    if (!retried.error && retried.data) return normalizeCollection(retried.data as CollectionRow);
  }
  throw operational(inserted.error?.message ?? "Could not create the Saved collection.");
}

async function resolveCollection(userId: string, collectionId?: string | null): Promise<ArchiveCollection> {
  if (!collectionId || collectionId === "saved") return ensureSavedCollection(userId);
  const collection = await getSupabaseAdmin()
    .from("archive_collections")
    .select(COLLECTION_SELECT)
    .eq("id", collectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (collection.error) throw operational(collection.error.message);
  if (!collection.data) throw new NotFoundError("Collection");
  return normalizeCollection(collection.data as CollectionRow);
}

async function countCollectionItems(collectionId: string, userId: string): Promise<number> {
  const result = await getSupabaseAdmin()
    .from("archive_collection_items")
    .select("archive_item_id", { count: "exact", head: true })
    .eq("collection_id", collectionId)
    .eq("user_id", userId);
  if (result.error) throw operational(result.error.message);
  return result.count ?? 0;
}

async function listSavedCollectionReferences(userId: string, query?: string): Promise<ArchiveCollection[]> {
  const db = getSupabaseAdmin();
  const references = await db
    .from("archive_saved_collections")
    .select("source_collection_id,saved_at")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });
  if (references.error) throw operational(references.error.message);
  if (!references.data?.length) return [];

  const ids = references.data.map((reference: any) => reference.source_collection_id);
  let request = db
    .from("archive_collections")
    .select(COLLECTION_SELECT)
    .in("id", ids)
    .neq("user_id", userId)
    .eq("visibility", "public");
  const search = cleanSearchTerm(query);
  if (search) request = request.ilike("name", `%${search}%`);
  const collectionsResult = await request;
  if (collectionsResult.error) throw operational(collectionsResult.error.message);

  const rows = (collectionsResult.data ?? []) as CollectionRow[];
  if (!rows.length) return [];
  const authorIds = [...new Set(rows.map(row => row.user_id))];
  const authorsResult = await db.from("users").select("id,full_name,avatar_url").in("id", authorIds);
  if (authorsResult.error) throw operational(authorsResult.error.message);
  const authors = new Map((authorsResult.data ?? []).map((author: any) => [author.id, author]));
  const savedAt = new Map(references.data.map((reference: any) => [reference.source_collection_id, reference.saved_at]));
  const counts = await Promise.all(rows.map(row => countCollectionItems(row.id, row.user_id)));

  return rows
    .map((row, index) => {
      const author: any = authors.get(row.user_id);
      return {
        ...normalizeCollection(row, counts[index]),
        author: author ? {
          id: String(author.id),
          full_name: String(author.full_name || "Zupiq learner"),
          avatar_url: author.avatar_url ? String(author.avatar_url) : null,
        } : null,
        is_saved_reference: true,
        read_only: true,
        is_saved: true,
        saved_at: String(savedAt.get(row.id) || "") || null,
      } satisfies ArchiveCollection;
    })
    .sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || "")));
}

export async function listCollections(userId: string, query?: string, includeShared = false): Promise<ArchiveCollection[]> {
  await ensureSavedCollection(userId);
  const db = getSupabaseAdmin();
  let request = db
    .from("archive_collections")
    .select(COLLECTION_SELECT)
    .eq("user_id", userId)
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: false });
  const search = cleanSearchTerm(query);
  if (search) request = request.ilike("name", `%${search}%`);
  const { data, error } = await request;
  if (error) throw operational(error.message);

  const rows = (data ?? []) as CollectionRow[];
  const counts = await Promise.all(rows.map((row) => countCollectionItems(row.id, userId)));
  const owned = rows.map((row, index) => normalizeCollection(row, counts[index]));
  if (!includeShared) return owned;
  return [...owned, ...await listSavedCollectionReferences(userId, query)];
}

export async function getCollection(userId: string, collectionId: string): Promise<ArchiveCollection> {
  const collection = await resolveCollection(userId, collectionId);
  return { ...collection, item_count: await countCollectionItems(collection.id, userId) };
}

export async function getViewableCollection(viewerId: string, collectionId: string): Promise<ArchiveCollection> {
  const db = getSupabaseAdmin();
  const result = await db
    .from("archive_collections")
    .select(COLLECTION_SELECT)
    .eq("id", collectionId)
    .maybeSingle();
  if (result.error) throw operational(result.error.message);
  if (!result.data) throw new NotFoundError("Collection");

  const collection = normalizeCollection(result.data as CollectionRow);
  if (collection.user_id !== viewerId && collection.visibility !== "public") {
    throw new ForbiddenError("This collection is private.");
  }
  const [authorResult, savedResult] = await Promise.all([
    db.from("users").select("id,full_name,avatar_url").eq("id", collection.user_id).maybeSingle(),
    collection.user_id === viewerId
      ? Promise.resolve({ data: null, error: null })
      : db.from("archive_saved_collections").select("source_collection_id").eq("user_id", viewerId).eq("source_collection_id", collection.id).maybeSingle(),
  ]);
  if (authorResult.error) throw operational(authorResult.error.message);
  if (savedResult.error) throw operational(savedResult.error.message);
  return {
    ...collection,
    item_count: await countCollectionItems(collection.id, collection.user_id),
    author: authorResult.data ? {
      id: String(authorResult.data.id),
      full_name: String(authorResult.data.full_name || "Zupiq learner"),
      avatar_url: authorResult.data.avatar_url ? String(authorResult.data.avatar_url) : null,
    } : null,
    read_only: collection.user_id !== viewerId,
    is_saved: Boolean(savedResult.data),
  };
}

export async function saveSharedCollectionReference(userId: string, collectionId: string): Promise<ArchiveCollection> {
  const collection = await getViewableCollection(userId, collectionId);
  if (collection.user_id === userId) {
    throw new ValidationError("Your own collections are already available in Archive.");
  }
  const result = await getSupabaseAdmin()
    .from("archive_saved_collections")
    .upsert({ user_id: userId, source_collection_id: collectionId }, { onConflict: "user_id,source_collection_id", ignoreDuplicates: true });
  if (result.error) throw operational(result.error.message);
  return { ...collection, is_saved_reference: true, read_only: true, is_saved: true };
}

export async function removeSharedCollectionReference(userId: string, collectionId: string): Promise<void> {
  const result = await getSupabaseAdmin()
    .from("archive_saved_collections")
    .delete()
    .eq("user_id", userId)
    .eq("source_collection_id", collectionId);
  if (result.error) throw operational(result.error.message);
}

export async function createCollection(
  userId: string,
  input: { name: string; color?: string; description?: string | null; icon?: string | null },
): Promise<ArchiveCollection> {
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  const color = COLLECTION_COLORS.has(input.color ?? "") ? input.color! : DEFAULT_COLOR;
  const result = await getSupabaseAdmin()
    .from("archive_collections")
    .insert({ user_id: userId, name, description, icon: input.icon ?? null, color, is_system: false })
    .select(COLLECTION_SELECT)
    .single();
  if (result.error?.code === "23505") throw duplicateCollectionError();
  if (result.error || !result.data) throw operational(result.error?.message ?? "Could not create collection.");
  return normalizeCollection(result.data as CollectionRow);
}

export async function updateCollection(
  userId: string,
  collectionId: string,
  input: { name?: string; color?: string; description?: string | null; icon?: string | null },
): Promise<ArchiveCollection> {
  const current = await resolveCollection(userId, collectionId);
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) {
    if (current.is_system) throw new ForbiddenError("The Saved collection cannot be renamed.");
    updates.name = input.name.trim();
  }
  if (input.color !== undefined) {
    if (!COLLECTION_COLORS.has(input.color)) throw new ValidationError("Invalid collection color.");
    updates.color = input.color;
  }
  if (input.description !== undefined) updates.description = input.description?.trim() || null;
  if (input.icon !== undefined) updates.icon = input.icon;
  if (!Object.keys(updates).length) return getCollection(userId, current.id);

  const result = await getSupabaseAdmin()
    .from("archive_collections")
    .update(updates)
    .eq("id", current.id)
    .eq("user_id", userId)
    .select(COLLECTION_SELECT)
    .single();
  if (result.error?.code === "23505") throw duplicateCollectionError();
  if (result.error || !result.data) throw operational(result.error?.message ?? "Could not update collection.");
  return normalizeCollection(result.data as CollectionRow, await countCollectionItems(current.id, userId));
}

export async function deleteCollection(userId: string, collectionId: string): Promise<void> {
  const collection = await resolveCollection(userId, collectionId);
  if (collection.is_system) throw new ForbiddenError("The Saved collection cannot be deleted.");
  const result = await getSupabaseAdmin()
    .from("archive_collections")
    .delete()
    .eq("id", collection.id)
    .eq("user_id", userId);
  if (result.error) throw operational(result.error.message);
}

type ResolvedSource = {
  sourceType: string | null;
  sourceId: string | null;
  title: string;
  preview: string | null;
  assetUrl: string | null;
  metadata: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown> | null;
};

async function resolveSource(userId: string, input: SaveArchiveItemInput): Promise<ResolvedSource> {
  const db = getSupabaseAdmin();
  const suppliedMetadata = cleanMetadata(input.metadata);

  if (input.type === "solution") {
    if (!input.sourceId) throw new ValidationError("sourceId is required for a solution.");
    const result = await db
      .from("study_sessions")
      .select("id,user_id,title,problem,image_url,subject_id,topic_id,breakdown_json,visual_table_json,created_at")
      .eq("id", input.sourceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) throw operational(result.error.message);
    if (!result.data) throw new NotFoundError("Study session");
    const row = result.data as any;
    return {
      sourceType: "study_session",
      sourceId: row.id,
      title: String(row.title || input.title || "Saved solution").slice(0, 200),
      preview: String(row.problem || input.preview || "").slice(0, 4000) || null,
      assetUrl: row.image_url ?? input.assetUrl ?? null,
      metadata: {
        ...suppliedMetadata,
        subjectId: row.subject_id ?? null,
        topicId: row.topic_id ?? null,
      },
      sourceSnapshot: {
        breakdown: row.breakdown_json ?? null,
        visualTable: row.visual_table_json ?? null,
        createdAt: row.created_at,
      },
    };
  }

  if (input.type === "post") {
    if (!input.sourceId) throw new ValidationError("sourceId is required for a post.");
    const result = await db
      .from("posts")
      .select("id,user_id,type,visibility,topic,caption,image_url,image_ocr_text,file_url,file_name,created_at")
      .eq("id", input.sourceId)
      .maybeSingle();
    if (result.error) throw operational(result.error.message);
    if (!result.data) throw new NotFoundError("Post");
    const row = result.data as any;
    if (row.user_id !== userId && row.visibility !== "public") {
      const follow = await db
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", userId)
        .eq("following_id", row.user_id)
        .maybeSingle();
      if (!follow.data) throw new ForbiddenError("This post is not available to save.");
    }
    return {
      sourceType: "post",
      sourceId: row.id,
      title: String(row.caption || row.topic || row.file_name || input.title || "Saved post").slice(0, 200),
      preview: String(row.caption || row.image_ocr_text || row.topic || input.preview || "").slice(0, 4000) || null,
      assetUrl: row.image_url ?? row.file_url ?? input.assetUrl ?? null,
      metadata: { ...suppliedMetadata, postType: row.type, topic: row.topic, fileName: row.file_name },
      sourceSnapshot: null,
    };
  }

  if (input.type === "image" && input.sourceId) {
    if (input.sourceType === "post" || input.sourceType === "post_image") {
      const postResult = await db
        .from("posts")
        .select("id,user_id,visibility,topic,caption,image_url,image_ocr_text,created_at")
        .eq("id", input.sourceId)
        .maybeSingle();
      if (postResult.error) throw operational(postResult.error.message);
      if (!postResult.data?.image_url) throw new NotFoundError("Post image");
      const post = postResult.data as any;
      if (post.user_id !== userId && post.visibility !== "public") {
        const follow = await db
          .from("user_follows")
          .select("following_id")
          .eq("follower_id", userId)
          .eq("following_id", post.user_id)
          .maybeSingle();
        if (!follow.data) throw new ForbiddenError("This post image is not available to save.");
      }
      return {
        sourceType: "post_image",
        sourceId: post.id,
        title: String(input.title || post.caption || post.topic || "Saved image").slice(0, 200),
        preview: String(input.preview || post.image_ocr_text || post.caption || "").slice(0, 4000) || null,
        assetUrl: post.image_url,
        metadata: { ...suppliedMetadata, topic: post.topic, sourcePostId: post.id },
        sourceSnapshot: null,
      };
    }
    const result = await db
      .from("uploads")
      .select("id,user_id,original_name,mime_type,size_bytes,storage_url")
      .eq("id", input.sourceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) throw operational(result.error.message);
    if (!result.data) throw new NotFoundError("Upload");
    const row = result.data as any;
    return {
      sourceType: "upload",
      sourceId: row.id,
      title: String(input.title || row.original_name || "Saved image").slice(0, 200),
      preview: input.preview?.slice(0, 4000) || null,
      assetUrl: row.storage_url ?? input.assetUrl ?? null,
      metadata: { ...suppliedMetadata, mimeType: row.mime_type, sizeBytes: row.size_bytes },
      sourceSnapshot: null,
    };
  }

  const title = input.title?.trim() || (input.type === "board" ? "Handwriting board" : input.type === "note" ? "Note" : "Saved image");
  if (input.type === "image" && !input.assetUrl) throw new ValidationError("assetUrl or sourceId is required for an image.");
  if (input.type === "note" && !input.preview?.trim()) throw new ValidationError("Note content is required.");
  if ((input.sourceType && !input.sourceId) || (!input.sourceType && input.sourceId)) {
    throw new ValidationError("sourceType and sourceId must be provided together.");
  }
  let itemMetadata = suppliedMetadata;
  let sourceSnapshot: Record<string, unknown> | null = null;
  if (input.type === "board") {
    const { boardState, canvasState, ...summaryMetadata } = suppliedMetadata;
    const editableState = boardState ?? canvasState;
    if (editableState === undefined) throw new ValidationError("Editable board state is required.");
    itemMetadata = summaryMetadata;
    sourceSnapshot = { boardState: editableState };
  }
  return {
    sourceType: input.sourceType?.trim() || null,
    sourceId: input.sourceId?.trim() || null,
    title: title.slice(0, 200),
    preview: input.preview?.trim().slice(0, 4000) || null,
    assetUrl: input.assetUrl?.trim() || null,
    metadata: itemMetadata,
    sourceSnapshot,
  };
}

async function enrichItems(userId: string, rows: any[]): Promise<ArchiveItem[]> {
  if (!rows.length) return [];
  const db = getSupabaseAdmin();
  const ids = rows.map((row) => row.id);
  const [membershipResult, noteResult] = await Promise.all([
    db.from("archive_collection_items").select("archive_item_id,collection_id").eq("user_id", userId).in("archive_item_id", ids),
    db.from("archive_item_notes").select("id,user_id,archive_item_id,content,created_at,updated_at").eq("user_id", userId).in("archive_item_id", ids),
  ]);
  if (membershipResult.error) throw operational(membershipResult.error.message);
  if (noteResult.error) throw operational(noteResult.error.message);

  const collections = new Map<string, string[]>();
  for (const membership of membershipResult.data ?? []) {
    const existing = collections.get(membership.archive_item_id) ?? [];
    existing.push(membership.collection_id);
    collections.set(membership.archive_item_id, existing);
  }
  const notes = new Map((noteResult.data ?? []).map((note: any) => [note.archive_item_id, note]));
  return rows.map((row) => ({
    ...row,
    metadata: normalizeMetadata(row.metadata),
    collection_ids: collections.get(row.id) ?? [],
    note: notes.get(row.id) ?? null,
  })) as ArchiveItem[];
}

async function syncLegacySavedState(
  userId: string,
  item: Pick<ArchiveItem, "source_type" | "source_id"> | any,
  saved: boolean,
): Promise<void> {
  if (!item.source_id) return;
  const db = getSupabaseAdmin();
  if (item.source_type === "post") {
    const result = saved
      ? await db.from("post_saves").insert({ user_id: userId, post_id: item.source_id })
      : await db.from("post_saves").delete().eq("user_id", userId).eq("post_id", item.source_id);
    if (result.error && !(saved && result.error.code === "23505")) throw operational(result.error.message);
  } else if (item.source_type === "study_session") {
    const result = await db
      .from("study_sessions")
      .update({ bookmarked: saved })
      .eq("id", item.source_id)
      .eq("user_id", userId);
    if (result.error) throw operational(result.error.message);
  }
}

export async function listArchiveItems(
  userId: string,
  options: { collectionId?: string; type?: ArchiveItemType; query?: string; cursor?: string; limit?: number; sort?: ArchiveSort } = {},
): Promise<{ items: ArchiveItem[]; nextCursor: string | null }> {
  const db = getSupabaseAdmin();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const sort = options.sort ?? "newest";
  const sortsByName = sort === "name_asc" || sort === "name_desc";
  const ascending = sort === "oldest" || sort === "name_asc";
  const sortField = sortsByName ? "title" : "last_saved_at";
  const offset = sortsByName && options.cursor ? Math.max(0, Number.parseInt(options.cursor, 10) || 0) : 0;
  let memberIds: string[] | null = null;
  if (options.collectionId) {
    const collection = await resolveCollection(userId, options.collectionId);
    const memberships = await db
      .from("archive_collection_items")
      .select("archive_item_id")
      .eq("user_id", userId)
      .eq("collection_id", collection.id);
    if (memberships.error) throw operational(memberships.error.message);
    memberIds = (memberships.data ?? []).map((row: any) => row.archive_item_id);
    if (!memberIds.length) return { items: [], nextCursor: null };
  }

  const search = cleanSearchTerm(options.query);
  let noteMatchIds: string[] = [];
  if (search) {
    const noteMatches = await db
      .from("archive_item_notes")
      .select("archive_item_id")
      .eq("user_id", userId)
      .ilike("content", `%${search}%`)
      .limit(200);
    if (noteMatches.error) throw operational(noteMatches.error.message);
    noteMatchIds = (noteMatches.data ?? []).map((row: any) => row.archive_item_id);
  }

  let request = db
    .from("archive_items")
    .select(ITEM_LIST_SELECT)
    .eq("user_id", userId)
    .order(sortField, { ascending })
    .order("id", { ascending });
  if (options.type) request = request.eq("type", options.type);
  if (options.cursor && !sortsByName) {
    request = ascending
      ? request.gt("last_saved_at", options.cursor)
      : request.lt("last_saved_at", options.cursor);
  }
  if (memberIds) request = request.in("id", memberIds);
  if (search) {
    const filters = [`title.ilike.%${search}%`, `preview.ilike.%${search}%`];
    if (noteMatchIds.length) filters.push(`id.in.(${noteMatchIds.join(",")})`);
    request = request.or(filters.join(","));
  }
  request = sortsByName
    ? request.range(offset, offset + limit)
    : request.limit(limit + 1);
  const result = await request;
  if (result.error) throw operational(result.error.message);
  const rows = (result.data ?? []) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: await enrichItems(userId, page),
    nextCursor: hasMore
      ? sortsByName
        ? String(offset + limit)
        : String(page[page.length - 1]?.last_saved_at ?? "") || null
      : null,
  };
}

export async function getArchiveItem(userId: string, itemId: string, markViewed = false): Promise<ArchiveItem> {
  const db = getSupabaseAdmin();
  const result = await db
    .from("archive_items")
    .select(ITEM_DETAIL_SELECT)
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw operational(result.error.message);
  if (!result.data) throw new NotFoundError("Archive item");
  if (markViewed) {
    await db.from("archive_items").update({ last_viewed_at: new Date().toISOString() }).eq("id", itemId).eq("user_id", userId);
  }
  return (await enrichItems(userId, [result.data]))[0];
}

export async function saveArchiveItem(userId: string, input: SaveArchiveItemInput): Promise<ArchiveItem> {
  const db = getSupabaseAdmin();
  const collection = await resolveCollection(userId, input.collectionId);
  const source = await resolveSource(userId, input);
  let itemRow: any;

  if (source.sourceType && source.sourceId) {
    const existing = await db
      .from("archive_items")
      .select(ITEM_DETAIL_SELECT)
      .eq("user_id", userId)
      .eq("source_type", source.sourceType)
      .eq("source_id", source.sourceId)
      .maybeSingle();
    if (existing.error) throw operational(existing.error.message);
    if (existing.data) {
      const updated = await db
        .from("archive_items")
        .update({ title: source.title, preview: source.preview, asset_url: source.assetUrl, metadata: source.metadata, source_snapshot: source.sourceSnapshot })
        .eq("id", existing.data.id)
        .eq("user_id", userId)
        .select(ITEM_DETAIL_SELECT)
        .single();
      if (updated.error) throw operational(updated.error.message);
      itemRow = updated.data;
    }
  }

  if (!itemRow) {
    const inserted = await db
      .from("archive_items")
      .insert({
        user_id: userId,
        type: input.type,
        source_type: source.sourceType,
        source_id: source.sourceId,
        title: source.title,
        preview: source.preview,
        asset_url: source.assetUrl,
        metadata: source.metadata,
        source_snapshot: source.sourceSnapshot,
      })
      .select(ITEM_DETAIL_SELECT)
      .single();
    if (inserted.error?.code === "23505" && source.sourceType && source.sourceId) {
      const concurrent = await db
        .from("archive_items")
        .select(ITEM_DETAIL_SELECT)
        .eq("user_id", userId)
        .eq("source_type", source.sourceType)
        .eq("source_id", source.sourceId)
        .single();
      if (concurrent.error) throw operational(concurrent.error.message);
      itemRow = concurrent.data;
    } else if (inserted.error || !inserted.data) {
      throw operational(inserted.error?.message ?? "Could not save archive item.");
    } else {
      itemRow = inserted.data;
    }
  }

  const membership = await db.from("archive_collection_items").insert({
    user_id: userId,
    collection_id: collection.id,
    archive_item_id: itemRow.id,
  });
  if (membership.error && membership.error.code !== "23505") throw operational(membership.error.message);
  if (collection.is_system) await syncLegacySavedState(userId, itemRow, true);
  return getArchiveItem(userId, itemRow.id);
}

export async function updateArchiveItem(
  userId: string,
  itemId: string,
  input: { title?: string; preview?: string | null; metadata?: Record<string, unknown> },
): Promise<ArchiveItem> {
  await getArchiveItem(userId, itemId);
  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title.trim();
  if (input.preview !== undefined) updates.preview = input.preview?.trim() || null;
  if (input.metadata !== undefined) updates.metadata = cleanMetadata(input.metadata);
  if (Object.keys(updates).length) {
    const result = await getSupabaseAdmin().from("archive_items").update(updates).eq("id", itemId).eq("user_id", userId);
    if (result.error) throw operational(result.error.message);
  }
  return getArchiveItem(userId, itemId);
}

export async function deleteArchiveItem(userId: string, itemId: string): Promise<void> {
  const item = await getArchiveItem(userId, itemId);
  await syncLegacySavedState(userId, item, false);
  const result = await getSupabaseAdmin().from("archive_items").delete().eq("id", itemId).eq("user_id", userId);
  if (result.error) throw operational(result.error.message);
}

export async function addItemToCollection(userId: string, collectionId: string, itemId: string): Promise<ArchiveItem> {
  const [collection, item] = await Promise.all([resolveCollection(userId, collectionId), getArchiveItem(userId, itemId)]);
  const result = await getSupabaseAdmin().from("archive_collection_items").insert({
    user_id: userId,
    collection_id: collection.id,
    archive_item_id: itemId,
  });
  if (result.error && result.error.code !== "23505") throw operational(result.error.message);
  if (collection.is_system) await syncLegacySavedState(userId, item, true);
  return getArchiveItem(userId, itemId);
}

export async function removeItemFromCollection(userId: string, collectionId: string, itemId: string): Promise<void> {
  const collection = await resolveCollection(userId, collectionId);
  const item = await getArchiveItem(userId, itemId);
  const db = getSupabaseAdmin();
  const result = await db
    .from("archive_collection_items")
    .delete()
    .eq("user_id", userId)
    .eq("collection_id", collection.id)
    .eq("archive_item_id", itemId);
  if (result.error) throw operational(result.error.message);
  if (collection.is_system) await syncLegacySavedState(userId, item, false);
}

export async function moveItemToCollection(
  userId: string,
  itemId: string,
  targetCollectionId: string,
  fromCollectionId?: string,
): Promise<ArchiveItem> {
  const target = await resolveCollection(userId, targetCollectionId);
  await getArchiveItem(userId, itemId);
  const db = getSupabaseAdmin();
  const inserted = await db.from("archive_collection_items").insert({
    user_id: userId,
    collection_id: target.id,
    archive_item_id: itemId,
  });
  if (inserted.error && inserted.error.code !== "23505") throw operational(inserted.error.message);
  if (target.is_system) {
    const item = await getArchiveItem(userId, itemId);
    await syncLegacySavedState(userId, item, true);
  }
  if (fromCollectionId) {
    const source = await resolveCollection(userId, fromCollectionId);
    if (source.id !== target.id) {
      const removed = await db
        .from("archive_collection_items")
        .delete()
        .eq("user_id", userId)
        .eq("collection_id", source.id)
        .eq("archive_item_id", itemId);
      if (removed.error) throw operational(removed.error.message);
      if (source.is_system) {
        const item = await getArchiveItem(userId, itemId);
        await syncLegacySavedState(userId, item, false);
      }
    }
  }
  return getArchiveItem(userId, itemId);
}

export async function removeSourceFromSaved(userId: string, sourceType: string, sourceId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const [saved, itemResult] = await Promise.all([
    ensureSavedCollection(userId),
    db.from("archive_items").select("id").eq("user_id", userId).eq("source_type", sourceType).eq("source_id", sourceId).maybeSingle(),
  ]);
  if (itemResult.error || !itemResult.data) return;
  await removeItemFromCollection(userId, saved.id, itemResult.data.id);
  const remaining = await db
    .from("archive_collection_items")
    .select("archive_item_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("archive_item_id", itemResult.data.id);
  if (!remaining.error && remaining.count === 0) {
    await db.from("archive_items").delete().eq("id", itemResult.data.id).eq("user_id", userId);
  }
}

export async function upsertItemNote(userId: string, itemId: string, content: string): Promise<ArchiveItemNote> {
  await getArchiveItem(userId, itemId);
  const result = await getSupabaseAdmin()
    .from("archive_item_notes")
    .upsert({ user_id: userId, archive_item_id: itemId, content: content.trim() }, { onConflict: "archive_item_id" })
    .select("id,user_id,archive_item_id,content,created_at,updated_at")
    .single();
  if (result.error || !result.data) throw operational(result.error?.message ?? "Could not save note.");
  return result.data as ArchiveItemNote;
}

export async function deleteItemNote(userId: string, itemId: string): Promise<void> {
  await getArchiveItem(userId, itemId);
  const result = await getSupabaseAdmin()
    .from("archive_item_notes")
    .delete()
    .eq("user_id", userId)
    .eq("archive_item_id", itemId);
  if (result.error) throw operational(result.error.message);
}
