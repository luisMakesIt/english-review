import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { scriptsTable, participantsTable, segmentsTable, scriptSettingsTable, practiceStateTable } from "./schema";
import type { ScriptRow, ParticipantRow, SegmentRow, ScriptSettingsRow, PracticeStateRow } from "./schema";
import type { ParsedDialogue } from "~/types/domain";
import { generateId } from "~/lib/dialogue-parser";

// ============================================================================
// Database client factory
// ============================================================================

/**
 * Get D1 database client from Cloudflare Workers environment
 */
export function getDb(d1: D1Database) {
  return drizzle(d1);
}

// ============================================================================
// Script operations
// ============================================================================

export async function getScript(db: ReturnType<typeof drizzle>, scriptId: string) {
  const [script] = await db.select().from(scriptsTable).where(eq(scriptsTable.id, scriptId));
  return script ?? null;
}

export async function getScriptWithData(db: ReturnType<typeof drizzle>, scriptId: string) {
  const script = await getScript(db, scriptId);
  if (!script) return null;
  
  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.scriptId, scriptId))
    .orderBy(participantsTable.orderIndex);
  
  const segments = await db
    .select()
    .from(segmentsTable)
    .where(eq(segmentsTable.scriptId, scriptId))
    .orderBy(segmentsTable.orderIndex);
  
  const [settings] = await db
    .select()
    .from(scriptSettingsTable)
    .where(eq(scriptSettingsTable.scriptId, scriptId));
  
  return {
    script,
    participants,
    segments,
    settings: settings ?? null,
  };
}

export async function createScript(
  db: ReturnType<typeof drizzle>,
  data: {
    title: string;
    description: string;
  }
) {
  const id = generateId();
  const now = new Date();
  
  await db.insert(scriptsTable).values({
    id,
    title: data.title,
    description: data.description,
    createdAt: now,
    updatedAt: now,
  });
  
  return id;
}

export async function createScriptFromDialogue(
  db: ReturnType<typeof drizzle>,
  dialogue: ParsedDialogue
) {
  const scriptId = generateId();
  const now = new Date();
  
  // Create script
  await db.insert(scriptsTable).values({
    id: scriptId,
    title: dialogue.title,
    description: dialogue.description ?? "",
    createdAt: now,
    updatedAt: now,
  });
  
  // Create participants
  for (let i = 0; i < dialogue.participants.length; i++) {
    const p = dialogue.participants[i];
    await db.insert(participantsTable).values({
      id: p.id,
      scriptId,
      name: p.name,
      color: p.color ?? "#6366f1",
      orderIndex: i,
      isActive: true,
    });
  }
  
  // Create segments
  for (let i = 0; i < dialogue.segments.length; i++) {
    const s = dialogue.segments[i];
    await db.insert(segmentsTable).values({
      id: generateId(),
      scriptId,
      participantId: s.participantId,
      orderIndex: i,
      english: s.english,
      pronunciation: s.pronunciation ?? "",
      spanish: s.spanish ?? "",
      audioUrl: s.audioUrl ?? null,
      durationMs: s.durationMs ?? null,
      timingMarkers: null,
    });
  }
  
  // Create default settings
  await db.insert(scriptSettingsTable).values({
    scriptId,
    focusParticipantId: null,
    allowSkip: true,
    showSegmentNumbers: true,
    highlightCurrentSegment: true,
  });
  
  return scriptId;
}

// ============================================================================
// Practice state operations
// ============================================================================

export async function getOrCreatePracticeState(
  db: ReturnType<typeof drizzle>,
  odbUserId: string,
  scriptId: string
) {
  const [existing] = await db
    .select()
    .from(practiceStateTable)
    .where(and(
      eq(practiceStateTable.odbUserId, odbUserId),
      eq(practiceStateTable.scriptId, scriptId)
    ));
  
  if (existing) return existing;
  
  const now = new Date();
  const id = generateId();
  
  await db.insert(practiceStateTable).values({
    id,
    odbUserId,
    scriptId,
    currentSegmentIndex: 0,
    completedSegmentIds: "[]",
    startedAt: now,
    lastPracticedAt: now,
    totalPracticeTimeMs: 0,
    repeatCount: 0,
  });
  
  return {
    id,
    odbUserId,
    scriptId,
    currentSegmentIndex: 0,
    completedSegmentIds: "[]",
    startedAt: now,
    lastPracticedAt: now,
    totalPracticeTimeMs: 0,
    repeatCount: 0,
  };
}

export async function updatePracticeState(
  db: ReturnType<typeof drizzle>,
  id: string,
  data: Partial<{
    currentSegmentIndex: number;
    completedSegmentIds: string;
    lastPracticedAt: Date;
    totalPracticeTimeMs: number;
    repeatCount: number;
  }>
) {
  await db.update(practiceStateTable).set(data).where(eq(practiceStateTable.id, id));
}
