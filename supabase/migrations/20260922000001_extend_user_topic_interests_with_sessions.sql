-- Extend user_topic_interests view to include authored posts and study session topic signals.
-- Creating a post about a topic is a strong interest signal (score 6).
-- Each study session where a topic is known is a strong interest signal (score 6 — stronger than a save).
-- The final view aggregates both sources so feed ranking reflects actual study behavior, not just post interactions.

CREATE OR REPLACE VIEW public.user_topic_interests AS
SELECT
  user_id,
  topic,
  SUM(interest_score) AS interest_score
FROM (
  -- Source 1: post engagement events
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
  FROM public.user_post_interactions upi
  JOIN public.posts p ON p.id = upi.post_id
  WHERE p.topic IS NOT NULL

  UNION ALL

  -- Source 2: authored posts (posting about a topic is a strong explicit signal)
  SELECT
    user_id,
    topic,
    6 AS interest_score
  FROM public.posts
  WHERE topic IS NOT NULL

  UNION ALL

  -- Source 3: study sessions (studying a topic is the strongest interest signal)
  SELECT
    user_id,
    topic,
    6 AS interest_score   -- per session, stronger than a save (5)
  FROM public.study_sessions
  WHERE topic IS NOT NULL
) combined
GROUP BY user_id, topic;
