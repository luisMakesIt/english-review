/**
 * API Route: /api/scripts
 * GET - List all scripts
 * POST - Create a new script
 */

import type { APIRoute } from "types/cloudflare";

export const onRequest: APIRoute = async (context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // GET /api/scripts - List all scripts
  if (context.request.method === "GET") {
    try {
      const db = context.env.DB as D1Database;
      
      // Get all scripts
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
      
      // Get participants and segments for each script
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
  if (context.request.method === "POST") {
    try {
      const body = await context.request.json() as { title?: string; description?: string; dialogue?: string };
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

      // Parse dialogue
      const parseResult = parseDialogue(dialogue);
      if (!parseResult.success) {
        return new Response(JSON.stringify({ error: parseResult.errors.join(", ") }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const db = context.env.DB as D1Database;
      const scriptId = generateId();
      const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

      // Create script
      await db
        .prepare(
          "INSERT INTO scripts (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(scriptId, title.trim(), (description || "").trim(), now, now)
        .run();

      // Create participants
      for (const participant of parseResult.participants) {
        await db
          .prepare(
            "INSERT INTO participants (id, script_id, name, color, order_index, is_active) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(participant.id, scriptId, participant.name, participant.color, participant.orderIndex, 1)
          .run();
      }

      // Create segments
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

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

// ============================================================================
// Dialogue Parser
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

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
