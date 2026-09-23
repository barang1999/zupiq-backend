import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError } from "../middlewares/error.middleware.js";
import { ARCHIVE_ITEM_TYPES, type ArchiveItemType, type SaveArchiveItemInput } from "../../models/archive.model.js";
import {
  addItemToCollection,
  createCollection,
  deleteArchiveItem,
  deleteCollection,
  deleteItemNote,
  getArchiveItem,
  getCollection,
  getViewableCollection,
  listArchiveItems,
  listCollections,
  moveItemToCollection,
  removeItemFromCollection,
  removeSharedCollectionReference,
  saveArchiveItem,
  saveSharedCollectionReference,
  updateArchiveItem,
  updateCollection,
  upsertItemNote,
} from "../../services/archive.service.js";

const router = Router();
router.use(requireAuth);

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredTrimmed(value: unknown, field: string, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    throw new ValidationError(`${field} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function archiveType(value: unknown, required = false): ArchiveItemType | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !ARCHIVE_ITEM_TYPES.includes(value as ArchiveItemType)) {
    throw new ValidationError(`type must be one of: ${ARCHIVE_ITEM_TYPES.join(", ")}.`);
  }
  return value as ArchiveItemType;
}

function saveInput(body: any, collectionId?: string): SaveArchiveItemInput {
  return {
    type: archiveType(body?.type, true)!,
    sourceId: optionalString(body?.sourceId ?? body?.source_id),
    sourceType: optionalString(body?.sourceType ?? body?.source_type),
    collectionId: collectionId ?? optionalString(body?.collectionId ?? body?.collection_id),
    title: optionalString(body?.title),
    preview: optionalString(body?.preview),
    assetUrl: optionalString(body?.assetUrl ?? body?.asset_url),
    metadata: body?.metadata,
  };
}

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new ValidationError("limit must be a positive integer.");
    const result = await listArchiveItems(req.user!.sub, {
      collectionId: optionalString(req.query.collectionId ?? req.query.collection_id),
      type: archiveType(req.query.type),
      query: optionalString(req.query.q ?? req.query.query),
      cursor: optionalString(req.query.cursor),
      limit,
    });
    res.json(result);
  } catch (error) { next(error); }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await saveArchiveItem(req.user!.sub, saveInput(req.body));
    res.status(201).json({ item });
  } catch (error) { next(error); }
});

router.get("/collections", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeShared = req.query.includeShared === "true" || req.query.includeShared === "1";
    const collections = await listCollections(req.user!.sub, optionalString(req.query.q), includeShared);
    res.json({ collections });
  } catch (error) { next(error); }
});

router.post("/collections", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = requiredTrimmed(req.body?.name, "Collection name", 50);
    const description = optionalString(req.body?.description);
    if (description && description.trim().length > 280) throw new ValidationError("Description cannot exceed 280 characters.");
    const collection = await createCollection(req.user!.sub, {
      name,
      color: optionalString(req.body?.color),
      description,
      icon: optionalString(req.body?.icon),
    });
    res.status(201).json({ collection });
  } catch (error) { next(error); }
});

router.post("/collections/:id/save", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const collection = await saveSharedCollectionReference(req.user!.sub, req.params.id);
    res.status(201).json({ collection });
  } catch (error) { next(error); }
});

router.delete("/collections/:id/save", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await removeSharedCollectionReference(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.get("/collections/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new ValidationError("limit must be a positive integer.");
    const collection = await getViewableCollection(req.user!.sub, req.params.id);
    const items = await listArchiveItems(collection.user_id, {
      collectionId: req.params.id,
      type: archiveType(req.query.type),
      query: optionalString(req.query.q),
      cursor: optionalString(req.query.cursor),
      limit,
    });
    const isOwner = collection.user_id === req.user!.sub;
    res.json({
      collection,
      items: isOwner ? items.items : items.items.map(item => ({ ...item, note: null })),
      nextCursor: items.nextCursor,
    });
  } catch (error) { next(error); }
});

router.patch("/collections/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = req.body?.name === undefined ? undefined : requiredTrimmed(req.body.name, "Collection name", 50);
    const description = req.body?.description === null ? null : optionalString(req.body?.description);
    if (description && description.trim().length > 280) throw new ValidationError("Description cannot exceed 280 characters.");
    const collection = await updateCollection(req.user!.sub, req.params.id, {
      name,
      color: optionalString(req.body?.color),
      description,
      icon: req.body?.icon === null ? null : optionalString(req.body?.icon),
    });
    res.json({ collection });
  } catch (error) { next(error); }
});

router.delete("/collections/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteCollection(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post("/collections/:id/items", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const archiveItemId = optionalString(req.body?.archiveItemId ?? req.body?.archive_item_id);
    const item = archiveItemId
      ? await addItemToCollection(req.user!.sub, req.params.id, archiveItemId)
      : await saveArchiveItem(req.user!.sub, saveInput(req.body, req.params.id));
    res.status(201).json({ item });
  } catch (error) { next(error); }
});

router.delete("/collections/:id/items/:archiveItemId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await removeItemFromCollection(req.user!.sub, req.params.id, req.params.archiveItemId);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post("/:id/move", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetCollectionId = requiredTrimmed(
      req.body?.targetCollectionId ?? req.body?.target_collection_id,
      "targetCollectionId",
      100,
    );
    const item = await moveItemToCollection(
      req.user!.sub,
      req.params.id,
      targetCollectionId,
      optionalString(req.body?.fromCollectionId ?? req.body?.from_collection_id),
    );
    res.json({ item });
  } catch (error) { next(error); }
});

router.put("/:id/note", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = requiredTrimmed(req.body?.content, "Note", 5000);
    const note = await upsertItemNote(req.user!.sub, req.params.id, content);
    res.json({ note });
  } catch (error) { next(error); }
});

router.delete("/:id/note", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteItemNote(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await getArchiveItem(req.user!.sub, req.params.id, true);
    res.json({ item });
  } catch (error) { next(error); }
});

router.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const title = req.body?.title === undefined ? undefined : requiredTrimmed(req.body.title, "Title", 200);
    const preview = req.body?.preview === null ? null : optionalString(req.body?.preview);
    if (preview && preview.length > 4000) throw new ValidationError("Preview cannot exceed 4000 characters.");
    const item = await updateArchiveItem(req.user!.sub, req.params.id, { title, preview, metadata: req.body?.metadata });
    res.json({ item });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteArchiveItem(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (error) { next(error); }
});

export default router;
