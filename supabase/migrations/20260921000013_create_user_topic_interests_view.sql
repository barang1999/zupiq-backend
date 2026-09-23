-- Derived view: per-user topic affinity scores.
-- Weighted by signal strength: authored post(6) > save(5) > comment/share(4) > like(3) > view(1).
-- Used by the personalized feed scoring function to compute topic_affinity per post.

CREATE OR REPLACE VIEW user_topic_interests AS
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
  FROM user_post_interactions upi
  JOIN posts p ON p.id = upi.post_id
  WHERE p.topic IS NOT NULL

  UNION ALL

  SELECT
    user_id,
    topic,
    6 AS interest_score
  FROM posts
  WHERE topic IS NOT NULL
) combined
GROUP BY user_id, topic;
