-- Add step_id column and convert content to JSONB for rich tutoring data
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS step_id TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_messages_step_id ON chat_messages (step_id);

-- Convert content to JSONB to support rich segments and better KaTeX performance
-- Note: This assumes existing content can be cast to JSONB or you are starting fresh.
-- If you have existing data, we can cast it to a JSON object: {"text": "..."}
ALTER TABLE chat_messages 
  ALTER COLUMN content TYPE JSONB 
  USING jsonb_build_object('text', content);
