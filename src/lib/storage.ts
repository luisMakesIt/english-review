/**
 * Local Storage Utilities for MVP
 * 
 * Provides localStorage-based persistence for scripts and karaoke state.
 * This is the MVP layer before D1 integration.
 */

import type { UserSettings, DisplayMode } from "~/types/domain";
import { DEFAULT_USER_SETTINGS } from "~/types/domain";

// ============================================================================
// Keys
// ============================================================================

const KEYS = {
  SCRIPTS: "er_scripts",
  SETTINGS: "er_settings",
  KARAOKE_STATE: "er_karaoke_state",
  CURRENT_SCRIPT: "er_current_script",
} as const;

// ============================================================================
// Types
// ============================================================================

export interface StoredScript {
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
    id: string;
    participantId: string;
    orderIndex: number;
    english: string;
    pronunciation: string;
    spanish: string;
  }>;
}

export interface KaraokeState {
  scriptId: string;
  currentSegmentIndex: number;
  completedSegmentIds: string[];
  startedAt: number;
  lastPracticedAt: number;
}

// ============================================================================
// Script Storage
// ============================================================================

function getScripts(): StoredScript[] {
  try {
    const data = localStorage.getItem(KEYS.SCRIPTS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveScripts(scripts: StoredScript[]): void {
  localStorage.setItem(KEYS.SCRIPTS, JSON.stringify(scripts));
}

export function getAllScripts(): StoredScript[] {
  return getScripts().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getScriptById(id: string): StoredScript | null {
  const scripts = getScripts();
  return scripts.find((s) => s.id === id) || null;
}

export function saveScript(script: StoredScript): void {
  const scripts = getScripts();
  const index = scripts.findIndex((s) => s.id === script.id);
  if (index >= 0) {
    scripts[index] = { ...script, updatedAt: Date.now() };
  } else {
    scripts.push(script);
  }
  saveScripts(scripts);
}

export function deleteScript(id: string): void {
  const scripts = getScripts().filter((s) => s.id !== id);
  saveScripts(scripts);
  // Also clear karaoke state for this script
  const karaokeStates = getAllKaraokeStates();
  const filtered = karaokeStates.filter((s) => s.scriptId !== id);
  localStorage.setItem(KEYS.KARAOKE_STATE, JSON.stringify(filtered));
}

export function createScript(data: {
  title: string;
  description: string;
  participants: StoredScript["participants"];
  segments: StoredScript["segments"];
}): StoredScript {
  const now = Date.now();
  const script: StoredScript = {
    id: generateScriptId(),
    title: data.title,
    description: data.description,
    createdAt: now,
    updatedAt: now,
    participants: data.participants,
    segments: data.segments,
  };
  saveScript(script);
  return script;
}

// ============================================================================
// Settings Storage
// ============================================================================

export function getSettings(): UserSettings {
  try {
    const data = localStorage.getItem(KEYS.SETTINGS);
    if (data) {
      return { ...DEFAULT_USER_SETTINGS, ...JSON.parse(data) };
    }
  } catch {
    // Fall through
  }
  return DEFAULT_USER_SETTINGS;
}

export function saveSettings(settings: Partial<UserSettings>): UserSettings {
  const current = getSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(updated));
  return updated;
}

export function updateSetting<K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K]
): void {
  const settings = getSettings();
  settings[key] = value;
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

// ============================================================================
// Karaoke State Storage
// ============================================================================

function getAllKaraokeStates(): KaraokeState[] {
  try {
    const data = localStorage.getItem(KEYS.KARAOKE_STATE);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveAllKaraokeStates(states: KaraokeState[]): void {
  localStorage.setItem(KEYS.KARAOKE_STATE, JSON.stringify(states));
}

export function getKaraokeState(scriptId: string): KaraokeState | null {
  const states = getAllKaraokeStates();
  return states.find((s) => s.scriptId === scriptId) || null;
}

export function saveKaraokeState(state: KaraokeState): void {
  const states = getAllKaraokeStates();
  const index = states.findIndex((s) => s.scriptId === state.scriptId);
  if (index >= 0) {
    states[index] = { ...state, lastPracticedAt: Date.now() };
  } else {
    states.push({ ...state, lastPracticedAt: Date.now() });
  }
  saveAllKaraokeStates(states);
}

export function clearKaraokeState(scriptId: string): void {
  const states = getAllKaraokeStates().filter((s) => s.scriptId !== scriptId);
  saveAllKaraokeStates(states);
}

export function initKaraokeState(scriptId: string): KaraokeState {
  const existing = getKaraokeState(scriptId);
  if (existing) return existing;
  
  const state: KaraokeState = {
    scriptId,
    currentSegmentIndex: 0,
    completedSegmentIds: [],
    startedAt: Date.now(),
    lastPracticedAt: Date.now(),
  };
  saveKaraokeState(state);
  return state;
}

// ============================================================================
// Current Script Tracking
// ============================================================================

export function setCurrentScriptId(id: string | null): void {
  if (id) {
    localStorage.setItem(KEYS.CURRENT_SCRIPT, id);
  } else {
    localStorage.removeItem(KEYS.CURRENT_SCRIPT);
  }
}

export function getCurrentScriptId(): string | null {
  return localStorage.getItem(KEYS.CURRENT_SCRIPT);
}

// ============================================================================
// Utilities
// ============================================================================

function generateScriptId(): string {
  return `script-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

export function clearAllData(): void {
  Object.values(KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}

// ============================================================================
// Demo Data
// ============================================================================

export function hasAnyScripts(): boolean {
  return getScripts().length > 0;
}

export function createDemoScript(): StoredScript {
  const now = Date.now();
  const scriptId = `script-${now.toString(36)}`;
  
  const participants = [
    { id: "p-1-receptionist", name: "Receptionist", color: "#6366f1" },
    { id: "p-2-guest", name: "Guest", color: "#10b981" },
  ];
  
  const segments = [
    { id: "seg-1", participantId: "p-1-receptionist", orderIndex: 0, english: "Good evening, welcome to the Grand Hotel. How may I help you?", pronunciation: "", spanish: "" },
    { id: "seg-2", participantId: "p-2-guest", orderIndex: 1, english: "Hi, I have a reservation under the name Smith.", pronunciation: "", spanish: "" },
    { id: "seg-3", participantId: "p-1-receptionist", orderIndex: 2, english: "Let me check that for you. Yes, I see your booking for a deluxe room.", pronunciation: "", spanish: "" },
    { id: "seg-4", participantId: "p-2-guest", orderIndex: 3, english: "Perfect. What time is checkout?", pronunciation: "", spanish: "" },
    { id: "seg-5", participantId: "p-1-receptionist", orderIndex: 4, english: "Checkout is at 11 AM. Would you like help with your luggage?", pronunciation: "", spanish: "" },
    { id: "seg-6", participantId: "p-2-guest", orderIndex: 5, english: "No thanks, I can manage. Where is the elevator?", pronunciation: "", spanish: "" },
    { id: "seg-7", participantId: "p-1-receptionist", orderIndex: 6, english: "The elevator is just behind you, to your left. Enjoy your stay!", pronunciation: "", spanish: "" },
    { id: "seg-8", participantId: "p-2-guest", orderIndex: 7, english: "Thank you so much. Have a great evening!", pronunciation: "", spanish: "" },
  ];
  
  const script: StoredScript = {
    id: scriptId,
    title: "Hotel Check-in Dialogue",
    description: "A common scenario for practicing hotel vocabulary and formal greetings.",
    createdAt: now,
    updatedAt: now,
    participants,
    segments,
  };
  
  saveScript(script);
  return script;
}
