-- Dev schema: create user_post_interactions and extend user_topic_interests view.

CREATE TABLE IF NOT EXISTS dev.user_post_interactions (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  post_id      TEXT        NOT NULL REFERENCES dev.posts (id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL CHECK (event_type IN ('view','like','save','comment','share')),
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, post_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_dev_upi_user_id    ON dev.user_post_interactions (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_upi_post_id    ON dev.user_post_interactions (post_id);
CREATE INDEX IF NOT EXISTS idx_dev_upi_created_at ON dev.user_post_interactions (created_at DESC);

CREATE OR REPLACE VIEW dev.user_topic_interests AS
SELECT
  user_id,
  topic,
  SUM(interest_score) AS interest_score
FROM (
  SELECT
    upi.user_id,
    p.topic,
    CASE upi.event_type
      WHEN 'view'    THEN 1
      WHEN 'like'    THEN 3
      WHEN 'save'    THEN 5
      WHEN 'comment' THEN 4
      WHEN 'share'   THEN 4
      ELSE 0
    END AS interest_score
  FROM dev.user_post_interactions upi
  JOIN dev.posts p ON p.id = upi.post_id
  WHERE p.topic IS NOT NULL

  UNION ALL

  SELECT
    user_id,
    topic,
    6 AS interest_score
  FROM dev.posts
  WHERE topic IS NOT NULL

  UNION ALL

  SELECT
    user_id,
    topic,
    6 AS interest_score
  FROM dev.study_sessions
  WHERE topic IS NOT NULL
) combined
GROUP BY user_id, topic;
