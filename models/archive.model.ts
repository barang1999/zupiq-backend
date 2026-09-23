export const ARCHIVE_ITEM_TYPES = ["solution", "post", "image", "board", "note"] as const;
export type ArchiveItemType = (typeof ARCHIVE_ITEM_TYPES)[number];

export interface ArchiveCollection {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  visibility: "private" | "unlisted" | "public";
  is_system: boolean;
  created_at: string;
  updated_at: string;
  item_count: number;
  author?: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
  is_saved_reference?: boolean;
  read_only?: boolean;
  is_saved?: boolean;
  saved_at?: string | null;
}

export interface ArchiveItemNote {
  id: string;
  user_id: string;
  archive_item_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ArchiveItem {
  id: string;
  user_id: string;
  type: ArchiveItemType;
  source_type: string | null;
  source_id: string | null;
  title: string;
  preview: string | null;
  asset_url: string | null;
  metadata: Record<string, unknown>;
  source_snapshot?: Record<string, unknown> | null;
  last_saved_at: string;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
  collection_ids: string[];
  note: ArchiveItemNote | null;
}

export interface SaveArchiveItemInput {
  type: ArchiveItemType;
  sourceId?: string | null;
  sourceType?: string | null;
  collectionId?: string | null;
  title?: string | null;
  preview?: string | null;
  assetUrl?: string | null;
  metadata?: Record<string, unknown>;
}
