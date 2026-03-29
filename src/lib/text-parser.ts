/**
 * Text-to-Script Parser
 * 
 * Transforms raw text in "Name: dialogue..." format into structured script data.
 * Supports multiple formats:
 * 
 * Simple format:
 *   John: Hello, how are you?
 *   Mary: I'm fine, thanks!
 * 
 * Multi-line with descriptions:
 *   John: Hello!
 *   [John smiles warmly]
 *   Mary: Hi there!
 */

import type { ParsedDialogue } from "~/types/domain";
import { generateId } from "./dialogue-parser";

export interface ParseResult {
  success: boolean;
  dialogue?: ParsedDialogue;
  participants: string[];  // unique participant names found
  segments: number;       // number of dialogue segments parsed
  errors: string[];       // parsing errors/warnings
}

/**
 * Parse raw text into a structured dialogue
 */
export function parseScriptText(
  text: string,
  title: string = "Untitled Script"
): ParseResult {
  const errors: string[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  
  const participantNames = new Set<string>();
  const segments: ParsedDialogue["segments"] = [];
  
  // Pattern for "Name: dialogue" format
  const speakerPattern = /^([A-Za-z][A-Za-z\s]*):\s*(.+)$/;
  // Pattern for stage directions [...]
  const stageDirectionPattern = /^\[(.+)\]$/;
  
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for speaker line
    const speakerMatch = line.match(speakerPattern);
    if (speakerMatch) {
      // Save previous speaker's lines
      if (currentSpeaker && currentLines.length > 0) {
        const dialogueText = currentLines.join(" ");
        if (dialogueText.trim()) {
          segments.push({
            participantId: getParticipantId(currentSpeaker, title),
            english: dialogueText.trim(),
            pronunciation: "",
            spanish: "",
          });
        }
        currentLines = [];
      }
      
      currentSpeaker = speakerMatch[1].trim();
      participantNames.add(currentSpeaker);
      currentLines.push(speakerMatch[2].trim());
    }
    // Check for stage direction (skip or use as dialogue continuation)
    else if (stageDirectionPattern.test(line)) {
      // Stage directions can be added to current dialogue or skipped
      const direction = line.match(stageDirectionPattern)![1];
      // Add as parenthetical if we have a current speaker
      if (currentSpeaker) {
        currentLines.push(`(${direction})`);
      }
    }
    // Continuation line (no speaker prefix)
    else if (currentSpeaker && line) {
      currentLines.push(line);
    }
    // Empty line - skip
    else if (!line) {
      continue;
    }
    // Unknown format - try to handle gracefully
    else {
      errors.push(`Line ${i + 1}: Unrecognized format "${line.substring(0, 50)}..."`);
    }
  }
  
  // Don't forget the last speaker's lines
  if (currentSpeaker && currentLines.length > 0) {
    const dialogueText = currentLines.join(" ");
    if (dialogueText.trim()) {
      segments.push({
        participantId: getParticipantId(currentSpeaker, title),
        english: dialogueText.trim(),
        pronunciation: "",
        spanish: "",
      });
    }
  }
  
  // Build participants array
  const participants = Array.from(participantNames).map((name, index) => ({
    id: getParticipantId(name, title),
    name,
    color: getDefaultColor(index),
  }));
  
  // Validate
  if (participants.length === 0) {
    errors.push("No speakers found. Use 'Name: dialogue' format.");
  }
  if (segments.length === 0) {
    errors.push("No dialogue segments found.");
  }
  
  // Detect if this looks like a script/dialogue
  if (participants.length > 0 && segments.length > 0 && participants.length < segments.length) {
    // Good - multiple segments per speaker
  } else if (participants.length === 1 && segments.length > 0) {
    errors.push("Only one speaker found. Add more participants for dialogue.");
  }
  
  return {
    success: participants.length > 0 && segments.length > 0,
    dialogue: {
      title,
      description: "",
      participants,
      segments,
    },
    participants: Array.from(participantNames),
    segments: segments.length,
    errors,
  };
}

/**
 * Generate a consistent participant ID from name
 */
function getParticipantId(name: string, context: string): string {
  const normalized = name.toLowerCase().replace(/\s+/g, "-");
  // Create a simple hash-like ID
  let hash = 0;
  const str = `${normalized}-${context}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `p-${Math.abs(hash).toString(36)}-${normalized.substring(0, 8)}`;
}

/**
 * Get default color for a participant based on index
 */
function getDefaultColor(index: number): string {
  const colors = [
    "#6366f1", // indigo
    "#10b981", // emerald
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#84cc16", // lime
  ];
  return colors[index % colors.length];
}

/**
 * Convert ParsedDialogue to plain object for storage
 */
export function dialogueToScriptData(dialogue: ParsedDialogue): {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  participants: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  segments: Array<{
    participantId: string;
    english: string;
  }>;
} {
  const now = Date.now();
  return {
    id: generateId(),
    title: dialogue.title || "Untitled",
    description: dialogue.description || "",
    createdAt: now,
    updatedAt: now,
    participants: dialogue.participants.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color || "#6366f1",
    })),
    segments: dialogue.segments.map((s) => ({
      participantId: s.participantId,
      english: s.english,
    })),
  };
}
