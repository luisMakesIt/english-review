-- ============================================================================
-- Initial Migration: English Review Core Schema
-- Created: 2026-03-28
-- Description: Base schema for karaoke-style oral practice app
-- ============================================================================

-- Scripts table: stores dialogue script metadata
CREATE TABLE IF NOT EXISTS `scripts` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

-- Participants table: speakers in a dialogue
CREATE TABLE IF NOT EXISTS `participants` (
  `id` text PRIMARY KEY NOT NULL,
  `script_id` text NOT NULL REFERENCES `scripts`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `color` text NOT NULL DEFAULT '#6366f1',
  `order_index` integer NOT NULL DEFAULT 0,
  `is_active` integer NOT NULL DEFAULT 1
);

-- Segments table: individual dialogue blocks/lines
CREATE TABLE IF NOT EXISTS `segments` (
  `id` text PRIMARY KEY NOT NULL,
  `script_id` text NOT NULL REFERENCES `scripts`(`id`) ON DELETE CASCADE,
  `participant_id` text NOT NULL REFERENCES `participants`(`id`) ON DELETE CASCADE,
  `order_index` integer NOT NULL DEFAULT 0,
  `english` text NOT NULL,
  `pronunciation` text NOT NULL DEFAULT '',
  `spanish` text NOT NULL DEFAULT '',
  `audio_url` text,
  `duration_ms` integer,
  `timing_markers` text
);

-- Script-specific settings
CREATE TABLE IF NOT EXISTS `script_settings` (
  `script_id` text PRIMARY KEY NOT NULL REFERENCES `scripts`(`id`) ON DELETE CASCADE,
  `focus_participant_id` text,
  `allow_skip` integer NOT NULL DEFAULT 1,
  `show_segment_numbers` integer NOT NULL DEFAULT 1,
  `highlight_current_segment` integer NOT NULL DEFAULT 1
);

-- Practice state per user per script
CREATE TABLE IF NOT EXISTS `practice_state` (
  `id` text PRIMARY KEY NOT NULL,
  `odb_user_id` text NOT NULL,
  `script_id` text NOT NULL REFERENCES `scripts`(`id`) ON DELETE CASCADE,
  `current_segment_index` integer NOT NULL DEFAULT 0,
  `completed_segment_ids` text NOT NULL DEFAULT '[]',
  `started_at` integer NOT NULL,
  `last_practiced_at` integer NOT NULL,
  `total_practice_time_ms` integer NOT NULL DEFAULT 0,
  `repeat_count` integer NOT NULL DEFAULT 0
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS `idx_participants_script_id` ON `participants` (`script_id`);
CREATE INDEX IF NOT EXISTS `idx_segments_script_id` ON `segments` (`script_id`);
CREATE INDEX IF NOT EXISTS `idx_segments_participant_id` ON `segments` (`participant_id`);
CREATE INDEX IF NOT EXISTS `idx_practice_state_user_script` ON `practice_state` (`odb_user_id`, `script_id`);
