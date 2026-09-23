-- Store optional on-device OCR text extracted from social post images.
-- This lets post moderation and topic detection use free local OCR output
-- instead of requiring AI vision for every image post.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS image_ocr_text TEXT;
