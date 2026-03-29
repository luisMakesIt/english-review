-- ============================================================================
-- Migration 0001: Add User Settings Table
-- Created: 2026-03-28
-- Description: Persist user settings in D1 for cross-device sync
-- ============================================================================

-- User settings table (per user, not per script)
CREATE TABLE IF NOT EXISTS `user_settings` (
  `odb_user_id` text PRIMARY KEY NOT NULL,
  `display_mode` text NOT NULL DEFAULT 'english-only',
  `auto_advance` integer NOT NULL DEFAULT 1,
  `auto_advance_delay_ms` integer NOT NULL DEFAULT 2000,
  `highlight_current_speaker` integer NOT NULL DEFAULT 1,
  `show_other_speakers` integer NOT NULL DEFAULT 1,
  `speech_rate` text NOT NULL DEFAULT '1.0',
  `preferred_voice` text,
  `text_size` text NOT NULL DEFAULT 'medium',
  `show_pronunciation` integer NOT NULL DEFAULT 1,
  `theme` text NOT NULL DEFAULT 'dark',
  `gesture_mode` integer NOT NULL DEFAULT 1,
  `updated_at` integer NOT NULL
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS `idx_user_settings_odb_user_id` ON `user_settings` (`odb_user_id`);
