-- Drizzle migration tracking table
CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `hash` text NOT NULL,
  `created_at` integer NOT NULL
);
