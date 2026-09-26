-- Add country_code column to users table
-- Stores ISO 3166-1 alpha-2 country code detected from device locale at registration
-- No GPS required — derived from expo-localization getLocales()[0].regionCode

ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code CHAR(2);
