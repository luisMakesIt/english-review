/**
 * API Route: /api/scripts/[scriptId]
 * GET - Get script details
 * DELETE - Delete a script
 */

import type { APIRoute } from "types/cloudflare";

export const onRequest: APIRoute = async (context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
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

  // GET /api/scripts/[scriptId] - Get script details
  if (context.request.method === "GET") {
    try {
      const db = context.env.DB as D1Database;

      // Get script
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

      // Get participants
      const participantsResult = await db
        .prepare("SELECT id, name, color FROM participants WHERE script_id = ? ORDER BY order_index")
        .bind(scriptId)
        .all();

      // Get segments
      const segmentsResult = await db
        .prepare("SELECT id, participant_id, order_index, english, pronunciation, spanish FROM segments WHERE script_id = ? ORDER BY order_index")
        .bind(scriptId)
        .all();

      const result = {
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
      };

      return new Response(JSON.stringify(result), {
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

  // DELETE /api/scripts/[scriptId] - Delete a script
  if (context.request.method === "DELETE") {
    try {
      const db = context.env.DB as D1Database;

      // Delete in correct order (segments, participants, script)
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

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};
