/**
 * API Route: /api/scripts/[scriptId]/karaoke
 * GET - Get karaoke/practice state for a script
 * PUT - Update karaoke/practice state
 */

import type { APIRoute } from "types/cloudflare";

export const onRequest: APIRoute = async (context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const scriptId = context.params.scriptId as string;

  if (!scriptId) {
    return new Response(JSON.stringify({ error: "Script ID required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Get user ID from header (in production, this would come from auth)
  const odbUserId = context.request.headers.get("X-User-Id") || "anonymous";

  // GET /api/scripts/[scriptId]/karaoke - Get practice state
  if (context.request.method === "GET") {
    try {
      const db = context.env.DB as D1Database;

      // Check if script exists
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

      // Get or create practice state
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
          startedAt: state.started_at * 1000, // Convert to ms
          lastPracticedAt: state.last_practiced_at * 1000,
          totalPracticeTimeMs: state.total_practice_time_ms,
          repeatCount: state.repeat_count,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create default state
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

  // PUT /api/scripts/[scriptId]/karaoke - Update practice state
  if (context.request.method === "PUT") {
    try {
      const body = await context.request.json() as {
        currentSegmentIndex?: number;
        completedSegmentIds?: string[];
        totalPracticeTimeMs?: number;
        repeatCount?: number;
      };
      const { currentSegmentIndex, completedSegmentIds, totalPracticeTimeMs, repeatCount } = body;

      const db = context.env.DB as D1Database;

      // Find existing state
      const existing = await db
        .prepare(
          "SELECT id FROM practice_state WHERE odb_user_id = ? AND script_id = ?"
        )
        .bind(odbUserId, scriptId)
        .first();

      if (existing) {
        const state: any = existing;
        // Build update query dynamically
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

      // Create new if doesn't exist
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

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};
