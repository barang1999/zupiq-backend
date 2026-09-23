#!/bin/bash
# Usage:
#   dbpush <filename_or_path> [public|dev|both]
#
# Examples:
#   dbpush 20260922000001_extend_user_topic_interests_with_sessions.sql both
#   dbpush supabase/migrations/20260922000001.sql dev
#   dbpush /full/path/to/file.sql

MIGRATIONS_DIR="$HOME/Documents/zupiq/zupiq-backend/supabase/migrations"
BACKEND_DIR="$HOME/Documents/zupiq/zupiq-backend"
INPUT=$1
SCHEMA=${2:-public}

if [ -z "$INPUT" ]; then
  echo "Usage: dbpush <file> [public|dev|both]"
  echo "Files in migrations/:"
  ls "$MIGRATIONS_DIR"/*.sql | xargs -I{} basename {}
  exit 1
fi

# Resolve file path — accept filename only, relative, or absolute
if [ -f "$INPUT" ]; then
  FILE="$INPUT"
elif [ -f "$MIGRATIONS_DIR/$INPUT" ]; then
  FILE="$MIGRATIONS_DIR/$INPUT"
elif [ -f "$BACKEND_DIR/$INPUT" ]; then
  FILE="$BACKEND_DIR/$INPUT"
else
  echo "Error: file not found: $INPUT"
  exit 1
fi

DB=$(grep '^DATABASE_URL=' "$BACKEND_DIR/.env.development" | cut -d= -f2-)

run_public() {
  echo "→ public"
  psql "$DB" -f "$FILE"
}

run_dev() {
  echo "→ dev"
  sed 's/public\./dev./g' "$FILE" | psql "$DB"
}

case $SCHEMA in
  dev)  run_dev ;;
  both) run_public && run_dev ;;
  *)    run_public ;;
esac
