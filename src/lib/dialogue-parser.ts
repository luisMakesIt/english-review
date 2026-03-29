import type { ParsedDialogue, Segment, Participant, TimingMarker, DisplayMode, VisibleSegment, UserSettings } from "~/types/domain";

// ============================================================================
// Dialogue JSON Parser
// Transforms structured JSON into domain entities
// ============================================================================

/**
 * Parse a JSON dialogue structure into Script, Participants, and Segments
 */
export function parseDialogueJson(json: ParsedDialogue): {
  participants: Participant[];
  segments: Segment[];
} {
  const participants: Participant[] = json.participants.map((p, index) => ({
    id: p.id,
    scriptId: "", // Will be set when associating with a script
    name: p.name,
    color: p.color ?? getDefaultColor(index),
    order: index,
    isActive: true,
  }));
  
  const segments: Segment[] = json.segments.map((s, index) => ({
    id: generateId(),
    scriptId: "", // Will be set when associating with a script
    participantId: s.participantId,
    orderIndex: index,
    english: s.english,
    pronunciation: s.pronunciation ?? "",
    spanish: s.spanish ?? "",
    audioUrl: s.audioUrl ?? null,
    durationMs: s.durationMs ?? null,
    timingMarkers: null, // TODO: Will be populated by AI pipeline
  }));
  
  return { participants, segments };
}

// ============================================================================
// Text-to-Dialogue Parser (Placeholder for AI transformation)
// ============================================================================

/**
 * Transform raw text/dialogue into structured JSON
 * 
 * This is a MOCK/PLACEHOLDER implementation.
 * The real implementation would use AI to:
 * 1. Parse natural language dialogue description
 * 2. Identify speakers and their lines
 * 3. Generate pronunciation guides
 * 4. Generate Spanish translations
 * 5. Optionally generate timing markers for karaoke
 * 
 * @param rawText - Natural language description of a dialogue
 * @returns Structured dialogue JSON ready for storage
 */
export async function transformTextToDialogue(rawText: string): Promise<ParsedDialogue> {
  // TODO: Replace with actual AI integration
  // For now, return a placeholder that shows the expected structure
  
  return {
    title: "Untitled Script",
    description: "Created from raw text",
    participants: [
      { id: "speaker-a", name: "Speaker A", color: "#6366f1" },
      { id: "speaker-b", name: "Speaker B", color: "#10b981" },
    ],
    segments: [
      {
        participantId: "speaker-a",
        english: rawText || "Hello, how are you?",
        pronunciation: "",
        spanish: "",
      },
    ],
  };
}

/**
 * Generate pronunciation guide from English text
 * 
 * MOCK: Uses simple phonetic approximations
 * REAL: Would use Text-to-Speech with phoneme extraction
 */
export function generatePronunciation(english: string): string {
  // Simple phonetic patterns for demonstration
  // TODO: Replace with actual IPA generation via AI/TTS
  return `[${english.toLowerCase()}]`;
}

// ============================================================================
// Segment Visibility Calculator
// Determines what content to show based on display mode and speaker focus
// ============================================================================

export interface VisibilityResult {
  showEnglish: boolean;
  showPronunciation: boolean;
  showSpanish: boolean;
}

/**
 * Calculate visibility for a segment based on display mode
 */
export function getSegmentVisibility(displayMode: DisplayMode): VisibilityResult {
  switch (displayMode) {
    case "english-only":
      return { showEnglish: true, showPronunciation: false, showSpanish: false };
    case "bilingual":
      return { showEnglish: true, showPronunciation: false, showSpanish: true };
    case "pronunciation":
      return { showEnglish: true, showPronunciation: true, showSpanish: true };
    case "full":
      return { showEnglish: true, showPronunciation: true, showSpanish: true };
  }
}

/**
 * Calculate which segments should be visible in karaoke mode
 * considering speaker focus and "other speakers" visibility
 */
export function getVisibleContent(
  segments: Segment[],
  currentIndex: number,
  settings: UserSettings,
  participants: Participant[]
): VisibleSegment[] {
  const currentSegment = segments[currentIndex];
  if (!currentSegment) return [];
  
  const focusParticipantId = participants.find(p => 
    settings.highlightCurrentSpeaker && p.isActive
  )?.id ?? null;
  
  return segments.map((segment, index) => {
    const isCurrentSpeaker = segment.participantId === currentSegment.participantId;
    const isOtherSpeaker = segment.participantId !== currentSegment.participantId;
    
    // Determine if this segment should be visible
    // In karaoke mode, we typically show the current speaker prominently
    // and may dim or hide other speakers
    const visibility = getSegmentVisibility(settings.displayMode);
    
    // If showing other speakers is disabled and this isn't the current segment
    const showSegment = settings.showOtherSpeakers || isCurrentSpeaker;
    
    return {
      ...segment,
      isCurrentSpeaker,
      isOtherSpeaker,
      visibility: showSegment ? visibility : { showEnglish: false, showPronunciation: false, showSpanish: false },
    };
  });
}

/**
 * Get the text to display for a segment based on visibility settings
 */
export function getDisplayText(
  segment: VisibleSegment,
  displayMode: DisplayMode
): {
  primary: string;
  secondary?: string;
  tertiary?: string;
} {
  const { visibility } = segment;
  
  if (displayMode === "english-only") {
    return { primary: segment.english };
  }
  
  if (displayMode === "pronunciation" || displayMode === "full") {
    return {
      primary: segment.english,
      secondary: visibility.showPronunciation ? segment.pronunciation : undefined,
      tertiary: visibility.showSpanish ? segment.spanish : undefined,
    };
  }
  
  if (displayMode === "bilingual") {
    return {
      primary: segment.english,
      secondary: visibility.showSpanish ? segment.spanish : undefined,
    };
  }
  
  return { primary: segment.english };
}

// ============================================================================
// Utility Functions
// ============================================================================

function getDefaultColor(index: number): string {
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
  return colors[index % colors.length];
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Parse timing markers from JSON string
 */
export function parseTimingMarkers(json: string | null): TimingMarker[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Serialize timing markers to JSON string
 */
export function serializeTimingMarkers(markers: TimingMarker[] | null): string | null {
  if (!markers) return null;
  return JSON.stringify(markers);
}
