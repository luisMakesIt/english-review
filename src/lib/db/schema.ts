import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ============================================================================
// Database Schema (Drizzle ORM)
// ============================================================================

// Scripts table
export const scriptsTable = sqliteTable("scripts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Participants table
export const participantsTable = sqliteTable("participants", {
  id: text("id").primaryKey(),
  scriptId: text("script_id").notNull().references(() => scriptsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  orderIndex: integer("order_index").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

// Segments table
export const segmentsTable = sqliteTable("segments", {
  id: text("id").primaryKey(),
  scriptId: text("script_id").notNull().references(() => scriptsTable.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull().references(() => participantsTable.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  english: text("english").notNull(),
  pronunciation: text("pronunciation").notNull().default(""),
  spanish: text("spanish").notNull().default(""),
  audioUrl: text("audio_url"),
  durationMs: integer("duration_ms"),
  timingMarkers: text("timing_markers"), // JSON string
});

// Script settings table
export const scriptSettingsTable = sqliteTable("script_settings", {
  scriptId: text("script_id").primaryKey().references(() => scriptsTable.id, { onDelete: "cascade" }),
  focusParticipantId: text("focus_participant_id"),
  allowSkip: integer("allow_skip", { mode: "boolean" }).notNull().default(true),
  showSegmentNumbers: integer("show_segment_numbers", { mode: "boolean" }).notNull().default(true),
  highlightCurrentSegment: integer("highlight_current_segment", { mode: "boolean" }).notNull().default(true),
});

// Practice state table
export const practiceStateTable = sqliteTable("practice_state", {
  id: text("id").primaryKey(),
  odbUserId: text("odb_user_id").notNull(),
  scriptId: text("script_id").notNull().references(() => scriptsTable.id, { onDelete: "cascade" }),
  currentSegmentIndex: integer("current_segment_index").notNull().default(0),
  completedSegmentIds: text("completed_segment_ids").notNull().default("[]"), // JSON array
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  lastPracticedAt: integer("last_practiced_at", { mode: "timestamp" }).notNull(),
  totalPracticeTimeMs: integer("total_practice_time_ms").notNull().default(0),
  repeatCount: integer("repeat_count").notNull().default(0),
});

// User settings table (per user, not per script)
export const userSettingsTable = sqliteTable("user_settings", {
  odbUserId: text("odb_user_id").primaryKey(),
  displayMode: text("display_mode").notNull().default("english-only"),
  autoAdvance: integer("auto_advance", { mode: "boolean" }).notNull().default(true),
  autoAdvanceDelayMs: integer("auto_advance_delay_ms").notNull().default(2000),
  highlightCurrentSpeaker: integer("highlight_current_speaker", { mode: "boolean" }).notNull().default(true),
  showOtherSpeakers: integer("show_other_speakers", { mode: "boolean" }).notNull().default(true),
  speechRate: text("speech_rate").notNull().default("1.0"), // Stored as string for simplicity
  preferredVoice: text("preferred_voice"),
  textSize: text("text_size").notNull().default("medium"), // 'small' | 'medium' | 'large' | 'xlarge'
  showPronunciation: integer("show_pronunciation", { mode: "boolean" }).notNull().default(true),
  theme: text("theme").notNull().default("dark"), // 'dark' | 'light' | 'high-contrast'
  gestureMode: integer("gesture_mode", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Type exports for database rows
export type ScriptRow = typeof scriptsTable.$inferSelect;
export type ParticipantRow = typeof participantsTable.$inferSelect;
export type SegmentRow = typeof segmentsTable.$inferSelect;
export type ScriptSettingsRow = typeof scriptSettingsTable.$inferSelect;
export type PracticeStateRow = typeof practiceStateTable.$inferSelect;
export type UserSettingsRow = typeof userSettingsTable.$inferSelect;
