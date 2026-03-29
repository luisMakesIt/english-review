import { createBrowserRouter, RouterProvider, Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchScripts,
  fetchScript,
  createScript as apiCreateScript,
  deleteScript as apiDeleteScript,
  getPracticeState as apiGetPracticeState,
  updatePracticeState as apiUpdatePracticeState,
  getUserSettings,
  saveUserSettings,
  type ScriptDetail,
} from "~/lib/api-client";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "~/types/domain";

// ============================================================================
// Types
// ============================================================================

interface KaraokeState {
  scriptId: string;
  currentSegmentIndex: number;
  completedSegmentIds: string[];
  startedAt: number;
  lastPracticedAt: number;
}

// ============================================================================
// Storage Utilities (localStorage for settings and offline cache)
// ============================================================================

const STORAGE_KEYS = {
  SCRIPTS_CACHE: "er_scripts_cache",
  SETTINGS: "er_settings",
  KARAOKE_STATE: "er_karaoke_state",
};

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// Convert API ScriptSummary (list) to StoredScript format
// Note: List endpoint doesn't include english/pronunciation/spanish
function toStoredScript(apiScript: ScriptSummaryForList) {
  return {
    id: apiScript.id,
    title: apiScript.title,
    description: apiScript.description,
    createdAt: apiScript.createdAt,
    updatedAt: apiScript.updatedAt,
    participants: apiScript.participants,
    segments: apiScript.segments.map((s) => ({
      ...s,
      english: "",
      pronunciation: "",
      spanish: "",
    })),
  };
}

// Convert API ScriptDetail to StoredScript format
function toStoredScriptFromDetail(apiScript: ScriptDetail) {
  return {
    id: apiScript.id,
    title: apiScript.title,
    description: apiScript.description,
    createdAt: apiScript.createdAt,
    updatedAt: apiScript.updatedAt,
    participants: apiScript.participants,
    segments: apiScript.segments,
  };
}

// ============================================================================
// Data Access Layer (API with localStorage fallback)
// ============================================================================

interface StoredScript {
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

// Script summary for list view (from API list endpoint)
interface ScriptSummaryForList {
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
  }>;
}

// Scripts cache for offline
function getCachedScripts(): StoredScript[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SCRIPTS_CACHE);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function setCachedScripts(scripts: StoredScript[]): void {
  localStorage.setItem(STORAGE_KEYS.SCRIPTS_CACHE, JSON.stringify(scripts));
}

async function loadScripts(): Promise<StoredScript[]> {
  try {
    const apiScripts = await fetchScripts();
    const scripts = apiScripts.map(toStoredScript);
    setCachedScripts(scripts);
    return scripts;
  } catch {
    // Fallback to cache
    return getCachedScripts();
  }
}

async function loadScript(id: string): Promise<StoredScript | null> {
  try {
    const apiScript = await fetchScript(id);
    return toStoredScriptFromDetail(apiScript);
  } catch {
    // Fallback to cache
    const cached = getCachedScripts();
    return cached.find((s) => s.id === id) || null;
  }
}

async function createScript(data: {
  title: string;
  description: string;
  participants: StoredScript["participants"];
  segments: Array<{ participantId: string; english: string; pronunciation: string; spanish: string }>;
}): Promise<StoredScript> {
  const dialogue = data.participants.map((p) => p.name + ": ").join("") + "\n" +
    data.segments.map((s) => {
      const p = data.participants.find((p) => p.id === s.participantId);
      return `${p?.name || "Speaker"}: ${s.english}`;
    }).join("\n");

  const result = await apiCreateScript({
    title: data.title,
    description: data.description,
    dialogue,
  });

  // Return optimistic script
  const now = Date.now();
  return {
    id: result.id,
    title: data.title,
    description: data.description,
    createdAt: now,
    updatedAt: now,
    participants: data.participants,
    segments: data.segments.map((s, i) => ({ ...s, id: generateId(), orderIndex: i })),
  };
}

async function removeScript(id: string): Promise<void> {
  try {
    await apiDeleteScript(id);
  } catch {
    // Continue with local delete even if API fails
  }
  // Remove from cache
  setCachedScripts(getCachedScripts().filter((s) => s.id !== id));
}

// Legacy sync functions for backwards compatibility
function getScripts(): StoredScript[] {
  return getCachedScripts();
}

function getScriptById(id: string): StoredScript | null {
  return getCachedScripts().find((s) => s.id === id) || null;
}

function deleteScript(id: string): void {
  removeScript(id); // Fire and forget
}

// Async settings functions that sync with API (localStorage as cache)
async function loadSettings(): Promise<UserSettings> {
  try {
    return await getUserSettings();
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}

async function persistSettings(settings: UserSettings): Promise<void> {
  // Always update localStorage cache first
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  // Then sync to API
  try {
    await saveUserSettings(settings);
  } catch (error) {
    console.warn("Failed to sync settings to API:", error);
  }
}

// ============================================================================
// Karaoke State (API primary, localStorage fallback/cache)
// ============================================================================

function getKaraokeStates(): KaraokeState[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.KARAOKE_STATE);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function saveKaraokeStates(states: KaraokeState[]): void {
  localStorage.setItem(STORAGE_KEYS.KARAOKE_STATE, JSON.stringify(states));
}

function getKaraokeState(scriptId: string): KaraokeState | null {
  return getKaraokeStates().find((s) => s.scriptId === scriptId) || null;
}

function saveKaraokeState(state: KaraokeState): void {
  const states = getKaraokeStates();
  const index = states.findIndex((s) => s.scriptId === state.scriptId);
  if (index >= 0) {
    states[index] = { ...state, lastPracticedAt: Date.now() };
  } else {
    states.push({ ...state, lastPracticedAt: Date.now() });
  }
  saveKaraokeStates(states);
}

function initKaraokeState(scriptId: string): KaraokeState {
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

// Async versions that sync with API
async function loadKaraokeState(scriptId: string): Promise<KaraokeState> {
  // Try local first for fast response
  const local = getKaraokeState(scriptId);
  
  try {
    const apiState = await apiGetPracticeState(scriptId);
    // Update local cache with API state
    saveKaraokeState({
      scriptId: apiState.scriptId,
      currentSegmentIndex: apiState.currentSegmentIndex,
      completedSegmentIds: apiState.completedSegmentIds,
      startedAt: apiState.startedAt,
      lastPracticedAt: apiState.lastPracticedAt,
    });
    return {
      scriptId: apiState.scriptId,
      currentSegmentIndex: apiState.currentSegmentIndex,
      completedSegmentIds: apiState.completedSegmentIds,
      startedAt: apiState.startedAt,
      lastPracticedAt: apiState.lastPracticedAt,
    };
  } catch {
    // Return local state if API fails
    return local || {
      scriptId,
      currentSegmentIndex: 0,
      completedSegmentIds: [],
      startedAt: Date.now(),
      lastPracticedAt: Date.now(),
    };
  }
}

async function syncKaraokeState(state: KaraokeState): Promise<void> {
  // Save locally first
  saveKaraokeState(state);
  
  // Then sync to API
  try {
    await apiUpdatePracticeState(state.scriptId, {
      currentSegmentIndex: state.currentSegmentIndex,
      completedSegmentIds: state.completedSegmentIds,
    });
  } catch {
    // Silently fail - local state is saved
  }
}

// ============================================================================
// Text Parser
// ============================================================================

interface ParseResult {
  success: boolean;
  participants: Array<{ id: string; name: string; color: string }>;
  segments: Array<{ participantId: string; english: string; pronunciation: string; spanish: string }>;
  errors: string[];
}

function parseScriptText(text: string, title: string): ParseResult {
  const errors: string[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const participantNames = new Set<string>();
  const segments: ParseResult["segments"] = [];
  
  const speakerPattern = /^([A-Za-z][A-Za-z\s]*):\s*(.+)$/;
  
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];
  
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
  
  for (const line of lines) {
    const speakerMatch = line.match(speakerPattern);
    if (speakerMatch) {
      if (currentSpeaker && currentLines.length > 0) {
        const dialogueText = currentLines.join(" ");
        if (dialogueText.trim()) {
          segments.push({
            participantId: `p-${currentSpeaker.toLowerCase().replace(/\s+/g, "-")}`,
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
    } else if (currentSpeaker && line) {
      currentLines.push(line);
    }
  }
  
  if (currentSpeaker && currentLines.length > 0) {
    const dialogueText = currentLines.join(" ");
    if (dialogueText.trim()) {
      segments.push({
        participantId: `p-${currentSpeaker.toLowerCase().replace(/\s+/g, "-")}`,
        english: dialogueText.trim(),
        pronunciation: "",
        spanish: "",
      });
    }
  }
  
  const participants = Array.from(participantNames).map((name, i) => ({
    id: `p-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    color: colors[i % colors.length],
  }));
  
  if (participants.length === 0) errors.push("No speakers found. Use 'Name: dialogue' format.");
  if (segments.length === 0) errors.push("No dialogue segments found.");
  
  return {
    success: participants.length > 0 && segments.length > 0,
    participants,
    segments,
    errors,
  };
}

// ============================================================================
// Layout Components
// ============================================================================

function RootLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold text-gray-900">
            English Review
          </Link>
          <Link
            to="/new"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + New
          </Link>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

// ============================================================================
// Home Page
// ============================================================================

function HomePage() {
  const [scripts, setScripts] = useState<StoredScript[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  useEffect(() => {
    async function load() {
      setLoading(true);
      let data = await loadScripts();
      // Create demo script if empty (local only, for offline)
      if (data.length === 0) {
        const demo = createDemoScript();
        // Try to sync demo to API
        try {
          const result = await apiCreateScript({
            title: demo.title,
            description: demo.description,
            dialogue: demo.participants.map((p) => p.name + ": ").join("") + "\n" +
              demo.segments.map((s) => {
                const p = demo.participants.find((p) => p.id === s.participantId);
                return `${p?.name || "Speaker"}: ${s.english}`;
              }).join("\n"),
          });
          demo.id = result.id;
        } catch {
          // Keep local demo if API fails
        }
        data = [demo];
      }
      setScripts(data.sort((a, b) => b.updatedAt - a.updatedAt));
      setLoading(false);
    }
    load();
  }, []);
  
  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("Delete this pista?")) {
      await removeScript(id);
      setScripts(getCachedScripts().sort((a, b) => b.updatedAt - a.updatedAt));
    }
  }, []);
  
  if (scripts.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-medium text-gray-900 mb-2">No pistas yet</h2>
        <p className="text-gray-500 mb-6">Create your first dialogue for karaoke practice</p>
        <Link
          to="/new"
          className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Create First Pista
        </Link>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Your Pistas</h2>
      {scripts.map((script) => {
        const karaokeState = getKaraokeState(script.id);
        const progress = karaokeState
          ? Math.round((karaokeState.completedSegmentIds.length / script.segments.length) * 100)
          : 0;
        
        return (
          <Link
            key={script.id}
            to={`/script/${script.id}`}
            className="block bg-white rounded-2xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 truncate">{script.title}</h3>
                {script.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{script.description}</p>
                )}
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex -space-x-2">
                    {script.participants.slice(0, 3).map((p) => (
                      <span
                        key={p.id}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                        style={{ backgroundColor: p.color }}
                        title={p.name}
                      >
                        {p.name.charAt(0)}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-gray-500">
                    {script.segments.length} segments
                  </span>
                  {progress > 0 && (
                    <span className="text-xs text-indigo-600 font-medium">
                      {progress}% done
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(script.id, e)}
                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                title="Delete pista"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ============================================================================
// New Script Page
// ============================================================================

function NewScriptPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    
    if (!title.trim()) {
      setErrors(["Please enter a title"]);
      return;
    }
    
    if (!dialogue.trim()) {
      setErrors(["Please enter dialogue content"]);
      return;
    }
    
    const parseResult = parseScriptText(dialogue, title);
    if (!parseResult.success) {
      setErrors(parseResult.errors);
      return;
    }
    
    setSubmitting(true);
    
    try {
      // Create script via API
      const script = await createScript({
        title: title.trim(),
        description: description.trim(),
        participants: parseResult.participants,
        segments: parseResult.segments.map((s, i) => ({
          ...s,
          orderIndex: i,
          pronunciation: s.pronunciation || "",
          spanish: s.spanish || "",
        })),
      });
      
      navigate(`/script/${script.id}`);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Failed to create script"]);
      setSubmitting(false);
    }
  }, [title, description, dialogue, navigate]);
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-semibold text-gray-900">New Pista</h2>
      </div>
      
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          {errors.map((err, i) => (
            <p key={i} className="text-sm text-red-600">{err}</p>
          ))}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Title
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., At the Restaurant"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
          />
        </div>
        
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description (optional)
          </label>
          <textarea
            id="description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the dialogue scenario..."
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-none"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Dialogue
          </label>
          <textarea
            id="dialogue"
            rows={10}
            value={dialogue}
            onChange={(e) => setDialogue(e.target.value)}
            placeholder={`Example format:
Receptionist: Good evening, welcome to the Grand Hotel.
Guest: Hi, I have a reservation under the name Smith.
Receptionist: Let me check that for you.
Guest: Perfect. What time is checkout?`}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow resize-none font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-2">
            Format: <code className="bg-gray-100 px-1 rounded">Name: dialogue text</code>
          </p>
        </div>
        
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Creating..." : "Create Pista"}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// Script Detail Page
// ============================================================================

function ScriptDetailPage() {
  const { scriptId } = useParams<{ scriptId: string }>();
  const navigate = useNavigate();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function load() {
      if (scriptId) {
        setLoading(true);
        const data = await loadScript(scriptId);
        setScript(data);
        setLoading(false);
      }
    }
    load();
  }, [scriptId]);

  const participantMap = useMemo(() => {
    const map = new Map<string, StoredScript["participants"][number]>();
    script?.participants.forEach((p) => map.set(p.id, p));
    return map;
  }, [script]);

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Loading pista...</p>
      </div>
    );
  }
  
  if (!script) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Pista not found</p>
        <Link to="/" className="text-indigo-600 hover:underline mt-4 inline-block">
          Go back home
        </Link>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-semibold text-gray-900">Pista Detail</h2>
      </div>
      
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-medium text-gray-900 text-lg">{script.title}</h3>
        {script.description && (
          <p className="text-gray-500 text-sm">{script.description}</p>
        )}
        
        <div className="pt-4 border-t border-gray-100">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Participants</h4>
          <div className="flex flex-wrap gap-2">
            {script.participants.map((p) => (
              <span
                key={p.id}
                className="px-3 py-1 text-sm rounded-full"
                style={{ backgroundColor: `${p.color}20`, color: p.color }}
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
        
        <div className="pt-4 border-t border-gray-100">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Preview</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {script.segments.map((seg, i) => {
              const participant = participantMap.get(seg.participantId);
              return (
                <div key={seg.id || i} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs font-medium"
                      style={{ color: participant?.color || "#6366f1" }}
                    >
                      {participant?.name || "Unknown"}
                    </span>
                    <span className="text-xs text-gray-400">#{i + 1}</span>
                  </div>
                  <p className="text-gray-900">{seg.english}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      <Link
        to={`/script/${script.id}/karaoke`}
        className="flex items-center justify-center gap-2 w-full py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Start Karaoke Practice
      </Link>
      
      <Link
        to="/settings"
        className="flex items-center justify-center gap-2 w-full py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
      >
        Settings
      </Link>
    </div>
  );
}

// ============================================================================
// Karaoke Page (Mobile-First, High Contrast)
// ============================================================================

function KaraokePage() {
  const { scriptId } = useParams<{ scriptId: string }>();
  const navigate = useNavigate();
  const [script, setScript] = useState<StoredScript | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  
  // Load script, karaoke state, and user settings
  useEffect(() => {
    async function load() {
      if (scriptId) {
        const [scriptData, stateData, settingsData] = await Promise.all([
          loadScript(scriptId),
          loadKaraokeState(scriptId),
          loadSettings(),
        ]);
        
        if (scriptData) {
          setScript(scriptData);
          setCurrentIndex(stateData.currentSegmentIndex);
          setCompletedIds(stateData.completedSegmentIds);
        }
        setSettings(settingsData);
      }
    }
    load();
  }, [scriptId]);
  
  // Auto-advance timer
  useEffect(() => {
    if (!isPlaying || !script || !settings.autoAdvance) return;
    
    const timer = setTimeout(() => {
      handleNext();
    }, settings.autoAdvanceDelayMs);
    
    return () => clearTimeout(timer);
  }, [isPlaying, currentIndex, script, settings.autoAdvance, settings.autoAdvanceDelayMs]);
  
  const handleNext = useCallback(() => {
    if (!script) return;
    
    const newIndex = Math.min(currentIndex + 1, script.segments.length - 1);
    setCurrentIndex(newIndex);
    
    const currentSeg = script.segments[currentIndex];
    if (currentSeg && !completedIds.includes(currentSeg.id)) {
      const newCompleted = [...completedIds, currentSeg.id];
      setCompletedIds(newCompleted);
      syncKaraokeState({
        scriptId: script.id,
        currentSegmentIndex: newIndex,
        completedSegmentIds: newCompleted,
        startedAt: Date.now(),
        lastPracticedAt: Date.now(),
      });
    }
    
    if (newIndex >= script.segments.length - 1) {
      setIsPlaying(false);
    }
  }, [script, currentIndex, completedIds]);
  
  const handlePrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
    setIsPlaying(false);
  }, []);
  
  const handleSegmentClick = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsPlaying(false);
  }, []);
  
  const handleTogglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);
  
  // Theme-based styles
  const theme = settings.theme || "dark";
  const isHighContrast = theme === "high-contrast";
  const bgColor = isHighContrast ? "#000000" : "#111827";
  const textColor = isHighContrast ? "#FFFFFF" : "#F9FAFB";
  const accentColor = isHighContrast ? "#FFFF00" : "#6366F1";
  
  // Text size classes
  const textSizeClass = {
    small: "text-2xl",
    medium: "text-3xl",
    large: "text-4xl",
    xlarge: "text-5xl",
  }[settings.textSize] || "text-3xl";
  
  if (!script) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bgColor, color: textColor }}>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }
  
  const currentSegment = script.segments[currentIndex];
  const participant = script.participants.find((p) => p.id === currentSegment?.participantId);
  const progress = script.segments.length > 0 ? ((currentIndex + 1) / script.segments.length) * 100 : 0;
  
  const getDisplayText = () => {
    if (!currentSegment) return { primary: "", secondary: "", tertiary: "" };
    
    const primary = currentSegment.english;
    let secondary = "";
    let tertiary = "";
    
    if (settings.displayMode === "bilingual" || settings.displayMode === "full") {
      secondary = currentSegment.spanish;
    }
    if (settings.displayMode === "pronunciation" || settings.displayMode === "full") {
      tertiary = currentSegment.pronunciation;
    }
    if (settings.showPronunciation && tertiary) {
      // Show pronunciation as secondary if showPronunciation is enabled but mode doesn't include it
    }
    
    return { primary, secondary, tertiary };
  };
  
  const display = getDisplayText();
  
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: bgColor, color: textColor }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: isHighContrast ? "#333333" : "#374151" }}>
        <button
          onClick={() => navigate(`/script/${script.id}`)}
          className="p-3 -ml-2 rounded-xl active:opacity-70 touch-manipulation"
          style={{ backgroundColor: isHighContrast ? "#1A1A1A" : "#1F2937" }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center flex-1 mx-4">
          <h1 className="text-base font-medium truncate">{script.title}</h1>
          <p className="text-xs opacity-60">Practice Mode</p>
        </div>
        <Link
          to="/settings"
          className="p-3 -mr-2 rounded-xl active:opacity-70 touch-manipulation"
          style={{ backgroundColor: isHighContrast ? "#1A1A1A" : "#1F2937" }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </header>
      
      {/* Speaker indicator - BIG and prominent */}
      <div className="flex items-center justify-center py-6">
        {participant && (
          <span
            className="px-6 py-2 text-lg font-bold rounded-full shadow-lg"
            style={{ 
              backgroundColor: participant.color,
              color: "#FFFFFF",
              boxShadow: `0 0 20px ${participant.color}80`
            }}
          >
            {participant.name}
          </span>
        )}
      </div>
      
      {/* Main display - LARGE text with high contrast */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-4">
        <div className="text-center space-y-6 max-w-lg w-full">
          {/* English text - PRIMARY */}
          <p className={`font-bold leading-relaxed ${textSizeClass}`} style={{ color: isHighContrast ? "#FFFF00" : "#FFFFFF" }}>
            {display.primary}
          </p>
          
          {/* Pronunciation - SECONDARY (if enabled) */}
          {settings.showPronunciation && display.tertiary && (
            <p className="text-xl opacity-80 font-mono" style={{ color: isHighContrast ? "#00FFFF" : "#A78BFA" }}>
              /{display.tertiary}/
            </p>
          )}
          
          {/* Spanish translation - TERTIARY */}
          {display.secondary && (
            <p className="text-lg opacity-60" style={{ color: isHighContrast ? "#CCCCCC" : "#9CA3AF" }}>
              {display.secondary}
            </p>
          )}
        </div>
        
        {/* Segment navigation - LARGE touch targets */}
        <div className="mt-8 w-full max-w-md">
          <div className="flex gap-2 overflow-x-auto pb-3 justify-center flex-wrap">
            {script.segments.map((seg, i) => {
              const p = script.participants.find((x) => x.id === seg.participantId);
              const isActive = i === currentIndex;
              const isCompleted = completedIds.includes(seg.id);
              const segColor = p?.color || "#6366f1";
              
              return (
                <button
                  key={seg.id}
                  onClick={() => handleSegmentClick(i)}
                  className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold transition-all touch-manipulation active:scale-95"
                  style={{
                    backgroundColor: isActive ? segColor : (isCompleted ? `${segColor}60` : `${segColor}30`),
                    color: isActive ? "#FFFFFF" : (isCompleted ? "#FFFFFF80" : "#FFFFFF60"),
                    boxShadow: isActive ? `0 0 0 3px ${bgColor}, 0 0 0 5px ${segColor}` : "none",
                    border: isHighContrast && !isActive ? "2px solid #FFFFFF40" : "none",
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
        
        {/* Progress bar - THICK and visible */}
        <div className="mt-6 w-full max-w-md">
          <div className="flex justify-between text-sm mb-2 opacity-70">
            <span>{currentIndex + 1} of {script.segments.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: isHighContrast ? "#333333" : "#374151" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ 
                width: `${progress}%`,
                backgroundColor: accentColor,
              }}
            />
          </div>
        </div>
      </main>
      
      {/* Controls - EXTRA LARGE touch targets */}
      <footer className="px-6 py-8 border-t" style={{ borderColor: isHighContrast ? "#333333" : "#374151" }}>
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all touch-manipulation active:scale-95 disabled:opacity-30"
            style={{ backgroundColor: isHighContrast ? "#1A1A1A" : "#374151" }}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 001.6-.8l-5.333 4z" />
            </svg>
          </button>
          
          <button
            onClick={handleTogglePlay}
            className="w-20 h-20 rounded-full flex items-center justify-center transition-all touch-manipulation active:scale-95 shadow-lg"
            style={{ 
              backgroundColor: accentColor,
              boxShadow: `0 0 30px ${accentColor}60`,
            }}
          >
            {isPlaying ? (
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>
          
          <button
            onClick={handleNext}
            disabled={currentIndex >= script.segments.length - 1}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all touch-manipulation active:scale-95 disabled:opacity-30"
            style={{ backgroundColor: isHighContrast ? "#1A1A1A" : "#374151" }}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// Settings Page (Improved UX)
// ============================================================================

function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [loading, setLoading] = useState(true);
  
  // Load settings from API on mount
  useEffect(() => {
    async function load() {
      try {
        const loaded = await loadSettings();
        setSettings(loaded);
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);
  
  const handleUpdate = useCallback((updates: Partial<UserSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    persistSettings(updated);
  }, [settings]);
  
  const handleDisplayModeChange = useCallback((mode: UserSettings["displayMode"]) => {
    handleUpdate({ displayMode: mode });
  }, [handleUpdate]);
  
  const handleToggle = useCallback((key: keyof UserSettings) => {
    handleUpdate({ [key]: !settings[key] });
  }, [settings, handleUpdate]);
  
  const handleTextSizeChange = useCallback((size: UserSettings["textSize"]) => {
    handleUpdate({ textSize: size });
  }, [handleUpdate]);
  
  const handleThemeChange = useCallback((theme: UserSettings["theme"]) => {
    handleUpdate({ theme });
  }, [handleUpdate]);
  
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse text-gray-400">Loading settings...</div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
      </div>
      
      <div className="space-y-4">
        {/* Display Mode */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900 mb-3">Display Mode</h3>
          <div className="grid grid-cols-2 gap-2">
            {(["english-only", "bilingual", "pronunciation", "full"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleDisplayModeChange(mode)}
                className={`p-3 text-left border-2 rounded-xl transition-all active:scale-98 ${
                  settings.displayMode === mode
                    ? "border-indigo-600 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300 active:bg-gray-50"
                }`}
              >
                <span className={`text-sm font-medium ${
                  settings.displayMode === mode ? "text-indigo-900" : "text-gray-700"
                }`}>
                  {mode.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                </span>
              </button>
            ))}
          </div>
        </div>
        
        {/* Text Size */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900 mb-3">Text Size</h3>
          <div className="flex gap-2">
            {(["small", "medium", "large", "xlarge"] as const).map((size) => (
              <button
                key={size}
                onClick={() => handleTextSizeChange(size)}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-xl border-2 transition-all ${
                  settings.textSize === size
                    ? "border-indigo-600 bg-indigo-50 text-indigo-900"
                    : "border-gray-200 hover:border-gray-300 text-gray-700"
                }`}
              >
                {size.charAt(0).toUpperCase() + size.slice(1)}
              </button>
            ))}
          </div>
        </div>
        
        {/* Theme */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900 mb-3">Theme</h3>
          <div className="flex gap-2">
            {([
              { value: "dark", label: "Dark", bg: "bg-gray-800", border: "border-gray-600" },
              { value: "light", label: "Light", bg: "bg-gray-100", border: "border-gray-300" },
              { value: "high-contrast", label: "High Contrast", bg: "bg-black", border: "border-yellow-400" },
            ] as const).map((theme) => (
              <button
                key={theme.value}
                onClick={() => handleThemeChange(theme.value)}
                className={`flex-1 py-3 px-2 text-sm font-medium rounded-xl border-2 transition-all ${
                  settings.theme === theme.value
                    ? `${theme.border} ${theme.bg} text-white`
                    : "border-gray-200 hover:border-gray-300 text-gray-700 bg-white"
                }`}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Auto Advance */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">Auto Advance</h3>
              <p className="text-sm text-gray-500">Automatically move to next segment</p>
            </div>
            <button
              onClick={() => handleToggle("autoAdvance")}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.autoAdvance ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.autoAdvance ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          
          {settings.autoAdvance && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Delay: {settings.autoAdvanceDelayMs}ms
              </label>
              <input
                type="range"
                min="500"
                max="5000"
                step="100"
                value={settings.autoAdvanceDelayMs}
                onChange={(e) => handleUpdate({ autoAdvanceDelayMs: parseInt(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.5s</span>
                <span>5s</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Highlight Current Speaker */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">Highlight Speaker</h3>
              <p className="text-sm text-gray-500">Emphasize the current speaker's turn</p>
            </div>
            <button
              onClick={() => handleToggle("highlightCurrentSpeaker")}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.highlightCurrentSpeaker ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.highlightCurrentSpeaker ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
        
        {/* Show Other Speakers */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">Show Other Speakers</h3>
              <p className="text-sm text-gray-500">Display segments from other participants</p>
            </div>
            <button
              onClick={() => handleToggle("showOtherSpeakers")}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.showOtherSpeakers ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.showOtherSpeakers ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
        
        {/* Show Pronunciation */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">Show Pronunciation</h3>
              <p className="text-sm text-gray-500">Display phonetic pronunciation guide</p>
            </div>
            <button
              onClick={() => handleToggle("showPronunciation")}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.showPronunciation ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.showPronunciation ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
        
        {/* Gesture Mode */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900">Gesture Mode</h3>
              <p className="text-sm text-gray-500">Swipe to navigate between segments</p>
            </div>
            <button
              onClick={() => handleToggle("gestureMode")}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.gestureMode ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.gestureMode ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
        
        {/* Speech Rate */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-gray-900">Speech Rate</h3>
            <span className="text-sm font-medium text-indigo-600">{settings.speechRate.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.speechRate}
            onChange={(e) => handleUpdate({ speechRate: parseFloat(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0.5x</span>
            <span>2.0x</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Demo Script Factory
// ============================================================================

function createDemoScript(): StoredScript {
  const now = Date.now();
  const scriptId = generateId();
  
  const participants = [
    { id: "p-receptionist", name: "Receptionist", color: "#6366f1" },
    { id: "p-guest", name: "Guest", color: "#10b981" },
  ];
  
  const segments = [
    { id: "seg-1", participantId: "p-receptionist", orderIndex: 0, english: "Good evening, welcome to the Grand Hotel. How may I help you?", pronunciation: "", spanish: "" },
    { id: "seg-2", participantId: "p-guest", orderIndex: 1, english: "Hi, I have a reservation under the name Smith.", pronunciation: "", spanish: "" },
    { id: "seg-3", participantId: "p-receptionist", orderIndex: 2, english: "Let me check that for you. Yes, I see your booking for a deluxe room.", pronunciation: "", spanish: "" },
    { id: "seg-4", participantId: "p-guest", orderIndex: 3, english: "Perfect. What time is checkout?", pronunciation: "", spanish: "" },
    { id: "seg-5", participantId: "p-receptionist", orderIndex: 4, english: "Checkout is at 11 AM. Would you like help with your luggage?", pronunciation: "", spanish: "" },
    { id: "seg-6", participantId: "p-guest", orderIndex: 5, english: "No thanks, I can manage. Where is the elevator?", pronunciation: "", spanish: "" },
    { id: "seg-7", participantId: "p-receptionist", orderIndex: 6, english: "The elevator is just behind you, to your left. Enjoy your stay!", pronunciation: "", spanish: "" },
    { id: "seg-8", participantId: "p-guest", orderIndex: 7, english: "Thank you so much. Have a great evening!", pronunciation: "", spanish: "" },
  ];
  
  return {
    id: scriptId,
    title: "Hotel Check-in Dialogue",
    description: "A common scenario for practicing hotel vocabulary and formal greetings.",
    createdAt: now,
    updatedAt: now,
    participants,
    segments,
  };
}

// ============================================================================
// Router Definition
// ============================================================================

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "new", element: <NewScriptPage /> },
      { path: "script/:scriptId", element: <ScriptDetailPage /> },
      { path: "script/:scriptId/karaoke", element: <KaraokePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
