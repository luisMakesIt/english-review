/**
 * Cloudflare Worker + Pages Functions Entry Point
 * 
 * This single file handles:
 * - Static assets (JS, CSS, images) via ASSETS binding
 * - SPA routing (serve index.html for client-side navigation)
 * - API routes: /api/scripts, /api/scripts/:id, /api/scripts/:id/karaoke
 * - D1 database integration for persistence
 */

export interface Env {
  ASSETS: {
    fetch: typeof fetch;
  };
  DB: D1Database;
}

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
};

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Dialogue Parser (for script creation)
// ============================================================================

interface ParsedParticipant {
  id: string;
  name: string;
  color: string;
  orderIndex: number;
}

interface ParsedSegment {
  id: string;
  participantId: string;
  orderIndex: number;
  english: string;
  pronunciation: string;
  spanish: string;
}

interface ParseDialogueResult {
  success: boolean;
  participants: ParsedParticipant[];
  segments: ParsedSegment[];
  errors: string[];
}

function parseDialogue(text: string): ParseDialogueResult {
  const errors: string[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const participantNames = new Set<string>();
  const segments: ParsedSegment[] = [];

  const speakerPattern = /^([A-Za-z][A-Za-z\s]*):\s*(.+)$/;
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const speakerMatch = line.match(speakerPattern);
    if (speakerMatch) {
      if (currentSpeaker && currentLines.length > 0) {
        const dialogueText = currentLines.join(" ");
        if (dialogueText.trim()) {
          segments.push({
            id: generateId(),
            participantId: `p-${currentSpeaker.toLowerCase().replace(/\s+/g, "-")}`,
            orderIndex: segments.length,
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
        id: generateId(),
        participantId: `p-${currentSpeaker.toLowerCase().replace(/\s+/g, "-")}`,
        orderIndex: segments.length,
        english: dialogueText.trim(),
        pronunciation: "",
        spanish: "",
      });
    }
  }

  const participants: ParsedParticipant[] = Array.from(participantNames).map((name, i) => ({
    id: `p-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    color: colors[i % colors.length],
    orderIndex: i,
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
// API Route Handlers
// ============================================================================

// GET /api/scripts - List all scripts
async function handleListScripts(db: D1Database): Promise<Response> {
  try {
    const scriptsResult = await db
      .prepare("SELECT id, title, description, created_at, updated_at FROM scripts ORDER BY updated_at DESC")
      .all();

    const scripts = scriptsResult.results as Array<{
      id: string;
      title: string;
      description: string;
      created_at: number;
      updated_at: number;
    }>;

    const scriptsWithData = await Promise.all(
      scripts.map(async (script) => {
        const participantsResult = await db
          .prepare("SELECT id, name, color FROM participants WHERE script_id = ? ORDER BY order_index")
          .bind(script.id)
          .all();

        const segmentsResult = await db
          .prepare("SELECT id, participant_id, order_index FROM segments WHERE script_id = ? ORDER BY order_index")
          .bind(script.id)
          .all();

        return {
          id: script.id,
          title: script.title,
          description: script.description,
          createdAt: script.created_at,
          updatedAt: script.updated_at,
          participants: participantsResult.results.map((p: any) => ({
            id: p.id,
            name: p.name,
            color: p.color,
          })),
          segments: segmentsResult.results.map((s: any) => ({
            id: s.id,
            participantId: s.participant_id,
            orderIndex: s.order_index,
          })),
          participantCount: participantsResult.results.length,
          segmentCount: segmentsResult.results.length,
        };
      })
    );

    return new Response(JSON.stringify(scriptsWithData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error listing scripts:", error);
    return new Response(JSON.stringify({ error: "Failed to list scripts" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// POST /api/scripts - Create a new script
async function handleCreateScript(db: D1Database, request: Request): Promise<Response> {
  try {
    const body = await request.json() as { title?: string; description?: string; dialogue?: string };
    const { title, description, dialogue } = body;

    if (!title?.trim()) {
      return new Response(JSON.stringify({ error: "Title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!dialogue?.trim()) {
      return new Response(JSON.stringify({ error: "Dialogue is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parseResult = parseDialogue(dialogue);
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: parseResult.errors.join(", ") }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const scriptId = generateId();
    const now = Math.floor(Date.now() / 1000);

    await db
      .prepare(
        "INSERT INTO scripts (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(scriptId, title.trim(), (description || "").trim(), now, now)
      .run();

    for (const participant of parseResult.participants) {
      await db
        .prepare(
          "INSERT INTO participants (id, script_id, name, color, order_index, is_active) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(participant.id, scriptId, participant.name, participant.color, participant.orderIndex, 1)
        .run();
    }

    for (const segment of parseResult.segments) {
      await db
        .prepare(
          "INSERT INTO segments (id, script_id, participant_id, order_index, english, pronunciation, spanish) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          segment.id,
          scriptId,
          segment.participantId,
          segment.orderIndex,
          segment.english,
          segment.pronunciation,
          segment.spanish
        )
        .run();
    }

    return new Response(JSON.stringify({ id: scriptId, success: true }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error creating script:", error);
    return new Response(JSON.stringify({ error: "Failed to create script" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// GET /api/scripts/:scriptId - Get script details
async function handleGetScript(db: D1Database, scriptId: string): Promise<Response> {
  try {
    const scriptResult = await db
      .prepare("SELECT id, title, description, created_at, updated_at FROM scripts WHERE id = ?")
      .bind(scriptId)
      .first();

    if (!scriptResult) {
      return new Response(JSON.stringify({ error: "Script not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const script = scriptResult as any;

    const participantsResult = await db
      .prepare("SELECT id, name, color FROM participants WHERE script_id = ? ORDER BY order_index")
      .bind(scriptId)
      .all();

    const segmentsResult = await db
      .prepare("SELECT id, participant_id, order_index, english, pronunciation, spanish FROM segments WHERE script_id = ? ORDER BY order_index")
      .bind(scriptId)
      .all();

    return new Response(JSON.stringify({
      id: script.id,
      title: script.title,
      description: script.description,
      createdAt: script.created_at,
      updatedAt: script.updated_at,
      participants: participantsResult.results.map((p: any) => ({
        id: p.id,
        name: p.name,
        color: p.color,
      })),
      segments: segmentsResult.results.map((s: any) => ({
        id: s.id,
        participantId: s.participant_id,
        orderIndex: s.order_index,
        english: s.english,
        pronunciation: s.pronunciation,
        spanish: s.spanish,
      })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error getting script:", error);
    return new Response(JSON.stringify({ error: "Failed to get script" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// DELETE /api/scripts/:scriptId - Delete a script
async function handleDeleteScript(db: D1Database, scriptId: string): Promise<Response> {
  try {
    await db.prepare("DELETE FROM segments WHERE script_id = ?").bind(scriptId).run();
    await db.prepare("DELETE FROM participants WHERE script_id = ?").bind(scriptId).run();
    await db.prepare("DELETE FROM scripts WHERE id = ?").bind(scriptId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error deleting script:", error);
    return new Response(JSON.stringify({ error: "Failed to delete script" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// GET /api/settings - Get user settings
async function handleGetSettings(db: D1Database, odbUserId: string): Promise<Response> {
  try {
    const result = await db
      .prepare("SELECT * FROM user_settings WHERE odb_user_id = ?")
      .bind(odbUserId)
      .first();

    if (result) {
      const settings = result as any;
      // Normalize types: speechRate is TEXT in DB, must be number in API response
      const speechRate = parseFloat(settings.speech_rate);
      return new Response(JSON.stringify({
        odbUserId: settings.odb_user_id,
        displayMode: settings.display_mode,
        autoAdvance: Boolean(settings.auto_advance),
        autoAdvanceDelayMs: Number(settings.auto_advance_delay_ms),
        highlightCurrentSpeaker: Boolean(settings.highlight_current_speaker),
        showOtherSpeakers: Boolean(settings.show_other_speakers),
        speechRate: isNaN(speechRate) ? 1.0 : speechRate,
        preferredVoice: settings.preferred_voice,
        textSize: settings.text_size,
        showPronunciation: Boolean(settings.show_pronunciation),
        theme: settings.theme,
        gestureMode: settings.gesture_mode === 1 || settings.gesture_mode === true,
        updatedAt: settings.updated_at,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return defaults if no settings exist yet
    return new Response(JSON.stringify({
      odbUserId,
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
      updatedAt: null,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error getting settings:", error);
    return new Response(JSON.stringify({ error: "Failed to get settings" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// PUT /api/settings - Update user settings
async function handlePutSettings(db: D1Database, odbUserId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      displayMode?: string;
      autoAdvance?: boolean;
      autoAdvanceDelayMs?: number;
      highlightCurrentSpeaker?: boolean;
      showOtherSpeakers?: boolean;
      speechRate?: number;
      preferredVoice?: string | null;
      textSize?: string;
      showPronunciation?: boolean;
      theme?: string;
      gestureMode?: boolean;
    };

    const existing = await db
      .prepare("SELECT odb_user_id FROM user_settings WHERE odb_user_id = ?")
      .bind(odbUserId)
      .first();

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      // Build dynamic update query
      const updates: string[] = ["updated_at = ?"];
      const values: any[] = [now];

      if (body.displayMode !== undefined) {
        updates.push("display_mode = ?");
        values.push(body.displayMode);
      }
      if (body.autoAdvance !== undefined) {
        updates.push("auto_advance = ?");
        values.push(body.autoAdvance ? 1 : 0);
      }
      if (body.autoAdvanceDelayMs !== undefined) {
        updates.push("auto_advance_delay_ms = ?");
        values.push(body.autoAdvanceDelayMs);
      }
      if (body.highlightCurrentSpeaker !== undefined) {
        updates.push("highlight_current_speaker = ?");
        values.push(body.highlightCurrentSpeaker ? 1 : 0);
      }
      if (body.showOtherSpeakers !== undefined) {
        updates.push("show_other_speakers = ?");
        values.push(body.showOtherSpeakers ? 1 : 0);
      }
      if (body.speechRate !== undefined) {
        updates.push("speech_rate = ?");
        values.push(body.speechRate);
      }
      if (body.preferredVoice !== undefined) {
        updates.push("preferred_voice = ?");
        values.push(body.preferredVoice);
      }
      if (body.textSize !== undefined) {
        updates.push("text_size = ?");
        values.push(body.textSize);
      }
      if (body.showPronunciation !== undefined) {
        updates.push("show_pronunciation = ?");
        values.push(body.showPronunciation ? 1 : 0);
      }
      if (body.theme !== undefined) {
        updates.push("theme = ?");
        values.push(body.theme);
      }
      if (body.gestureMode !== undefined) {
        updates.push("gesture_mode = ?");
        values.push(body.gestureMode ? 1 : 0);
      }

      values.push(odbUserId);

      await db
        .prepare(`UPDATE user_settings SET ${updates.join(", ")} WHERE odb_user_id = ?`)
        .bind(...values)
        .run();
    } else {
      // Insert new settings
      await db
        .prepare(`INSERT INTO user_settings (
          odb_user_id, display_mode, auto_advance, auto_advance_delay_ms,
          highlight_current_speaker, show_other_speakers, speech_rate,
          preferred_voice, text_size, show_pronunciation, theme, gesture_mode, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          odbUserId,
          body.displayMode || "english-only",
          body.autoAdvance !== false ? 1 : 0,
          body.autoAdvanceDelayMs || 2000,
          body.highlightCurrentSpeaker !== false ? 1 : 0,
          body.showOtherSpeakers !== false ? 1 : 0,
          body.speechRate || 1.0,
          body.preferredVoice || null,
          body.textSize || "medium",
          body.showPronunciation !== false ? 1 : 0,
          body.theme || "dark",
          body.gestureMode !== false ? 1 : 0,
          now
        )
        .run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return new Response(JSON.stringify({ error: "Failed to update settings" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// GET /api/scripts/:scriptId/karaoke - Get practice state
async function handleGetKaraoke(db: D1Database, scriptId: string, odbUserId: string): Promise<Response> {
  try {
    const scriptResult = await db
      .prepare("SELECT id FROM scripts WHERE id = ?")
      .bind(scriptId)
      .first();

    if (!scriptResult) {
      return new Response(JSON.stringify({ error: "Script not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stateResult = await db
      .prepare(
        "SELECT id, script_id, current_segment_index, completed_segment_ids, started_at, last_practiced_at, total_practice_time_ms, repeat_count FROM practice_state WHERE odb_user_id = ? AND script_id = ?"
      )
      .bind(odbUserId, scriptId)
      .first();

    if (stateResult) {
      const state = stateResult as any;
      return new Response(JSON.stringify({
        id: state.id,
        scriptId: state.script_id,
        currentSegmentIndex: state.current_segment_index,
        completedSegmentIds: JSON.parse(state.completed_segment_ids || "[]"),
        startedAt: state.started_at * 1000,
        lastPracticedAt: state.last_practiced_at * 1000,
        totalPracticeTimeMs: state.total_practice_time_ms,
        repeatCount: state.repeat_count,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const id = `practice-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    await db
      .prepare(
        "INSERT INTO practice_state (id, odb_user_id, script_id, current_segment_index, completed_segment_ids, started_at, last_practiced_at, total_practice_time_ms, repeat_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id, odbUserId, scriptId, 0, "[]", now, now, 0, 0)
      .run();

    return new Response(JSON.stringify({
      id,
      scriptId,
      currentSegmentIndex: 0,
      completedSegmentIds: [],
      startedAt: now * 1000,
      lastPracticedAt: now * 1000,
      totalPracticeTimeMs: 0,
      repeatCount: 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error getting practice state:", error);
    return new Response(JSON.stringify({ error: "Failed to get practice state" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// PUT /api/scripts/:scriptId/karaoke - Update practice state
async function handleUpdateKaraoke(db: D1Database, scriptId: string, odbUserId: string, request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      currentSegmentIndex?: number;
      completedSegmentIds?: string[];
      totalPracticeTimeMs?: number;
      repeatCount?: number;
    };
    const { currentSegmentIndex, completedSegmentIds, totalPracticeTimeMs, repeatCount } = body;

    const existing = await db
      .prepare(
        "SELECT id FROM practice_state WHERE odb_user_id = ? AND script_id = ?"
      )
      .bind(odbUserId, scriptId)
      .first();

    if (existing) {
      const state: any = existing;
      const updates: string[] = ["last_practiced_at = ?"];
      const values: any[] = [Math.floor(Date.now() / 1000)];

      if (typeof currentSegmentIndex === "number") {
        updates.push("current_segment_index = ?");
        values.push(currentSegmentIndex);
      }
      if (Array.isArray(completedSegmentIds)) {
        updates.push("completed_segment_ids = ?");
        values.push(JSON.stringify(completedSegmentIds));
      }
      if (typeof totalPracticeTimeMs === "number") {
        updates.push("total_practice_time_ms = ?");
        values.push(totalPracticeTimeMs);
      }
      if (typeof repeatCount === "number") {
        updates.push("repeat_count = ?");
        values.push(repeatCount);
      }

      values.push(state.id);

      await db
        .prepare(`UPDATE practice_state SET ${updates.join(", ")} WHERE id = ?`)
        .bind(...values)
        .run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const id = `practice-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    await db
      .prepare(
        "INSERT INTO practice_state (id, odb_user_id, script_id, current_segment_index, completed_segment_ids, started_at, last_practiced_at, total_practice_time_ms, repeat_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        odbUserId,
        scriptId,
        currentSegmentIndex ?? 0,
        Array.isArray(completedSegmentIds) ? JSON.stringify(completedSegmentIds) : "[]",
        now,
        now,
        totalPracticeTimeMs ?? 0,
        repeatCount ?? 0
      )
      .run();

    return new Response(JSON.stringify({ success: true, created: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error updating practice state:", error);
    return new Response(JSON.stringify({ error: "Failed to update practice state" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// API Router
// ============================================================================

async function handleApiRequest(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const method = request.method;

  // OPTIONS - CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Route: /api/settings
  if (pathParts.length === 1 && pathParts[0] === "settings") {
    const odbUserId = request.headers.get("X-User-Id") || "anonymous";
    
    if (method === "GET") {
      return handleGetSettings(db, odbUserId);
    }
    if (method === "PUT") {
      return handlePutSettings(db, odbUserId, request);
    }
  }

  // Route: /api/scripts
  if (pathParts.length === 1 && pathParts[0] === "scripts") {
    if (method === "GET") {
      return handleListScripts(db);
    }
    if (method === "POST") {
      return handleCreateScript(db, request);
    }
  }

  // Route: /api/scripts/:scriptId
  if (pathParts.length === 2 && pathParts[0] === "scripts") {
    const scriptId = pathParts[1];
    
    if (method === "GET") {
      return handleGetScript(db, scriptId);
    }
    if (method === "DELETE") {
      return handleDeleteScript(db, scriptId);
    }
  }

  // Route: /api/scripts/:scriptId/karaoke
  if (pathParts.length === 3 && pathParts[0] === "scripts" && pathParts[2] === "karaoke") {
    const scriptId = pathParts[1];
    const odbUserId = request.headers.get("X-User-Id") || "anonymous";

    if (method === "GET") {
      return handleGetKaraoke(db, scriptId, odbUserId);
    }
    if (method === "PUT") {
      return handleUpdateKaraoke(db, scriptId, odbUserId, request);
    }
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================================
// Main Worker Handler
// ============================================================================

const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // API routes - handle via D1
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env.DB);
    }

    // Static assets (JS, CSS, images)
    if (
      url.pathname.startsWith("/assets/") ||
      (url.pathname.includes(".") && !url.pathname.endsWith("/"))
    ) {
      try {
        if (env.ASSETS) {
          const assetResponse = await env.ASSETS.fetch(request);
          if (assetResponse.ok || assetResponse.status === 404) {
            const response = new Response(assetResponse.body, assetResponse);
            response.headers.set("Access-Control-Allow-Origin", "*");
            return response;
          }
        }
      } catch {
        // Fall through
      }
    }

    // SPA routing: delegate to ASSETS binding which has
    // not_found_handling = "single-page-application" configured
    // This will automatically serve index.html for non-asset, non-API requests
    if (
      !url.pathname.startsWith("/api/") &&
      !url.pathname.includes(".") &&
      url.pathname !== "/favicon.ico"
    ) {
      if (env.ASSETS) {
        // Pass original request to ASSETS - it handles SPA fallback automatically
        const response = await env.ASSETS.fetch(request);
        const corsResponse = new Response(response.body, response);
        corsResponse.headers.set("Access-Control-Allow-Origin", "*");
        return corsResponse;
      }
    }

    // Final fallback
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain",
      },
    });
  },
};

export default worker;
