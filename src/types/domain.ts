// ============================================================================
// Display Modes for Karaoke Practice
// ============================================================================

export type DisplayMode = 
  | "english-only"     // Show only English text
  | "bilingual"        // Show English + Spanish translation
  | "pronunciation"    // Show pronunciation guide + Spanish
  | "full";            // Show all: English, pronunciation, Spanish

// ============================================================================
// User Settings
// ============================================================================

export interface UserSettings {
  displayMode: DisplayMode;
  autoAdvance: boolean;
  autoAdvanceDelayMs: number;
  highlightCurrentSpeaker: boolean;
  showOtherSpeakers: boolean;
  speechRate: number; // 0.5 to 2.0
  preferredVoice: string | null;
  textSize: "small" | "medium" | "large" | "xlarge";
  showPronunciation: boolean;
  theme: "dark" | "light" | "high-contrast";
  gestureMode: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  displayMode: "english-only",
  autoAdvance: true,
  autoAdvanceDelayMs: 2000,
  highlightCurrentSpeaker: true,
  showOtherSpeakers: true,
  speechRate: 1.0,
  preferredVoice: null,
  textSize: "medium",
  showPronunciation: true,
  theme: "dark",
  gestureMode: true,
};

// ============================================================================
// Script & Dialogue Structure
// ============================================================================

export interface Script {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  settings: ScriptSettings;
}

export interface ScriptSettings {
  focusParticipantId: string | null;
  allowSkip: boolean;
  showSegmentNumbers: boolean;
  highlightCurrentSegment: boolean;
}

export const DEFAULT_SCRIPT_SETTINGS: ScriptSettings = {
  focusParticipantId: null,
  allowSkip: true,
  showSegmentNumbers: true,
  highlightCurrentSegment: true,
};

// ============================================================================
// Participant (Speaker in the dialogue)
// ============================================================================

export interface Participant {
  id: string;
  scriptId: string;
  name: string;
  color: string; // hex color for highlighting
  order: number;
  isActive: boolean; // whether this participant is in focus mode
}

// ============================================================================
// Segment (a single line/dialogue block)
// ============================================================================

export interface Segment {
  id: string;
  scriptId: string;
  participantId: string;
  orderIndex: number;
  
  // Core content
  english: string;
  pronunciation: string;
  spanish: string;
  
  // Optional metadata
  audioUrl: string | null;
  durationMs: number | null;
  
  // For karaoke: timing markers (word-level timestamps)
  timingMarkers: TimingMarker[] | null;
}

export interface TimingMarker {
  word: string;
  startMs: number;
  endMs: number;
}

// ============================================================================
// Practice State (persisted per user per script)
// ============================================================================

export interface PracticeState {
  id: string;
  odbUserId: string;
  scriptId: string;
  currentSegmentIndex: number;
  completedSegmentIds: string[];
  startedAt: number;
  lastPracticedAt: number;
  totalPracticeTimeMs: number;
  repeatCount: number;
}

// ============================================================================
// Parsed Dialogue JSON structure (input format for parser)
// ============================================================================

export interface ParsedDialogue {
  title: string;
  description?: string;
  participants: Array<{
    id: string;
    name: string;
    color?: string;
  }>;
  segments: Array<{
    participantId: string;
    english: string;
    pronunciation?: string;
    spanish?: string;
    audioUrl?: string;
    durationMs?: number;
  }>;
}

// ============================================================================
// Segment with computed visibility (for karaoke display)
// ============================================================================

export interface VisibleSegment extends Segment {
  isCurrentSpeaker: boolean;
  isOtherSpeaker: boolean;
  visibility: {
    showEnglish: boolean;
    showPronunciation: boolean;
    showSpanish: boolean;
  };
}
