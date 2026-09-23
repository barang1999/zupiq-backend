-- Grant anon, authenticated, and service_role access to the dev schema.
-- Required because new schemas are not accessible by default.

GRANT USAGE ON SCHEMA dev TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA dev TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA dev TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA dev TO anon, authenticated, service_role;

-- Auto-grant for any future tables added to the dev schema
ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
