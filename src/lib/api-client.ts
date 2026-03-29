/**
 * API Client for English Review Backend
 * 
 * Makes fetch calls to the Cloudflare Pages Functions API routes.
 * These connect to D1 for real persistence.
 */

import type { UserSettings } from "~/types/domain";
import { DEFAULT_USER_SETTINGS } from "~/types/domain";

// ============================================================================
// Types
// ============================================================================

export interface ScriptSummary {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  participants: Array<{ id: string; name: string; color: string }>;
  segments: Array<{ id: string; participantId: string; orderIndex: number }>;
  participantCount: number;
  segmentCount: number;
}

export interface ScriptDetail {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  participants: Array<{ id: string; name: string; color: string }>;
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
  id: string;
  scriptId: string;
  currentSegmentIndex: number;
  completedSegmentIds: string[];
  startedAt: number;
  lastPracticedAt: number;
  totalPracticeTimeMs: number;
  repeatCount: number;
}

export interface CreateScriptRequest {
  title: string;
  description?: string;
  dialogue: string;
}

// ============================================================================
// API Base URL
// ============================================================================

// In Cloudflare Pages, API routes are at /api/*
// The base URL is relative to the origin
const API_BASE = "/api";

// ============================================================================
// User ID Management
// ============================================================================

// For anonymous usage, we generate and persist a user ID
const USER_ID_KEY = "er_user_id";

function getUserId(): string {
  try {
    let userId = localStorage.getItem(USER_ID_KEY);
    if (!userId) {
      userId = `user-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(USER_ID_KEY, userId);
    }
    return userId;
  } catch {
    return `user-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================================================
// Scripts API
// ============================================================================

/**
 * Fetch all scripts (summary list)
 */
export async function fetchScripts(): Promise<ScriptSummary[]> {
  const response = await fetch(`${API_BASE}/scripts`);
  if (!response.ok) {
    throw new Error(`Failed to fetch scripts: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch a single script with full details
 */
export async function fetchScript(scriptId: string): Promise<ScriptDetail> {
  const response = await fetch(`${API_BASE}/scripts/${scriptId}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Script not found");
    }
    throw new Error(`Failed to fetch script: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new script from dialogue text
 */
export async function createScript(data: CreateScriptRequest): Promise<{ id: string; success: boolean }> {
  const response = await fetch(`${API_BASE}/scripts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(error.error || `Failed to create script: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Delete a script
 */
export async function deleteScript(scriptId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/scripts/${scriptId}`, {
    method: "DELETE",
  });
  
  if (!response.ok) {
    throw new Error(`Failed to delete script: ${response.statusText}`);
  }
}

// ============================================================================
// Karaoke/Practice State API
// ============================================================================

/**
 * Get practice state for a script
 */
export async function getPracticeState(scriptId: string): Promise<KaraokeState> {
  const response = await fetch(`${API_BASE}/scripts/${scriptId}/karaoke`, {
    headers: {
      "X-User-Id": getUserId(),
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get practice state: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Update practice state
 */
export async function updatePracticeState(
  scriptId: string,
  data: Partial<Pick<KaraokeState, "currentSegmentIndex" | "completedSegmentIds" | "totalPracticeTimeMs" | "repeatCount">>
): Promise<void> {
  const response = await fetch(`${API_BASE}/scripts/${scriptId}/karaoke`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getUserId(),
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update practice state: ${response.statusText}`);
  }
}

// ============================================================================
// Local Storage Cache (for offline/optimistic updates)
// ============================================================================

// Local storage keys
const CACHE_KEYS = {
  SCRIPTS: "er_scripts_cache",
  SETTINGS: "er_settings",
} as const;

/**
 * Get cached scripts list (fast, before API responds)
 */
export function getCachedScripts(): ScriptSummary[] | null {
  try {
    const data = localStorage.getItem(CACHE_KEYS.SCRIPTS);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Cache scripts list
 */
export function cacheScripts(scripts: ScriptSummary[]): void {
  try {
    localStorage.setItem(CACHE_KEYS.SCRIPTS, JSON.stringify(scripts));
  } catch {
    // Ignore cache errors
  }
}

/**
 * Get cached script detail
 */
export function getCachedScript(scriptId: string): ScriptDetail | null {
  try {
    const key = `er_script_${scriptId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Cache script detail
 */
export function cacheScript(script: ScriptDetail): void {
  try {
    const key = `er_script_${script.id}`;
    localStorage.setItem(key, JSON.stringify(script));
  } catch {
    // Ignore cache errors
  }
}

// ============================================================================
// User Settings API (D1 persistence)
// ============================================================================

export interface ApiUserSettings {
  odbUserId: string;
  displayMode: UserSettings["displayMode"];
  autoAdvance: boolean;
  autoAdvanceDelayMs: number;
  highlightCurrentSpeaker: boolean;
  showOtherSpeakers: boolean;
  speechRate: number;
  preferredVoice: string | null;
  textSize: string;
  showPronunciation: boolean;
  theme: string;
  gestureMode: boolean;
  updatedAt: number | null;
}

const SETTINGS_CACHE_KEY = "er_settings_cache";

/**
 * Get user settings from API (with localStorage cache as fallback)
 */
export async function getUserSettings(): Promise<UserSettings> {
  const cache = getCachedSettings();
  if (cache) {
    // Return cache immediately, then refresh from API in background
    fetchAndCacheSettings().catch(() => {});
    return cache;
  }
  
  return fetchAndCacheSettings();
}

/**
 * Fetch settings from API and cache locally
 */
async function fetchAndCacheSettings(): Promise<UserSettings> {
  try {
    const response = await fetch(`${API_BASE}/settings`, {
      headers: {
        "X-User-Id": getUserId(),
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.statusText}`);
    }
    
    const apiSettings: ApiUserSettings = await response.json();
    const settings: UserSettings = {
      displayMode: apiSettings.displayMode as UserSettings["displayMode"],
      autoAdvance: Boolean(apiSettings.autoAdvance),
      autoAdvanceDelayMs: Number(apiSettings.autoAdvanceDelayMs),
      highlightCurrentSpeaker: Boolean(apiSettings.highlightCurrentSpeaker),
      showOtherSpeakers: Boolean(apiSettings.showOtherSpeakers),
      // speechRate comes from DB as TEXT - normalize to number
      speechRate: typeof apiSettings.speechRate === "number" 
        ? apiSettings.speechRate 
        : parseFloat(String(apiSettings.speechRate)) || 1.0,
      preferredVoice: apiSettings.preferredVoice,
      // Extended fields with defaults
      textSize: (apiSettings as any).textSize || "medium",
      showPronunciation: (apiSettings as any).showPronunciation ?? true,
      theme: (apiSettings as any).theme || "dark",
      // gestureMode comes from DB as 0/1 integer - normalize to boolean
      gestureMode: typeof (apiSettings as any).gestureMode === "boolean" 
        ? (apiSettings as any).gestureMode 
        : Boolean((apiSettings as any).gestureMode),
    };
    
    cacheSettings(settings);
    return settings;
  } catch (error) {
    console.warn("Failed to fetch settings from API, using defaults:", error);
    return { ...DEFAULT_USER_SETTINGS };
  }
}

/**
 * Save settings to API and update local cache
 */
export async function saveUserSettings(settings: UserSettings): Promise<void> {
  // Save to local cache immediately
  cacheSettings(settings);
  
  // Then sync to API
  try {
    const response = await fetch(`${API_BASE}/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": getUserId(),
      },
      body: JSON.stringify(settings),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save settings: ${response.statusText}`);
    }
  } catch (error) {
    console.warn("Failed to sync settings to API:", error);
    // Settings are still cached locally
  }
}

/**
 * Get cached settings from localStorage
 */
export function getCachedSettings(): UserSettings | null {
  try {
    const data = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (data) {
      const cached = JSON.parse(data);
      return { ...DEFAULT_USER_SETTINGS, ...cached };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Cache settings to localStorage
 */
export function cacheSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}
