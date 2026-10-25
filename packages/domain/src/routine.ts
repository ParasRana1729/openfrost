import { z } from 'zod';

/**
 * Owner-confirmed weekly planning routines (spec §3.C, S06). A routine is a
 * reviewed task template scoped to one project plus a local-time schedule;
 * the runtime — not a browser — runs each due occurrence through the one
 * global task executor. Occurrence identity is the scheduled local calendar
 * date, so ticks, restarts, clock changes, and DST transitions cannot
 * duplicate or replay work.
 */

export const routineStateSchema = z.enum(['active', 'paused']);
export type RoutineState = z.infer<typeof routineStateSchema>;

/** Sunday=0 … Saturday=6, matching Date.getDay(). */
export const WEEKDAY_NAMES: ReadonlyArray<string> = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm (24h)');

export const routineScheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('weekly'),
    weekday: z.number().int().min(0).max(6),
    time: timeSchema,
  }),
  z.strictObject({
    kind: z.literal('daily'),
    time: timeSchema,
  }),
]);
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>;

/**
 * The task template the owner reviewed before enabling. The routine enqueues
 * a `weekly_plan` task from this template; it is never free-form agent work.
 */
export const routineTemplateSchema = z.strictObject({
  title: z.string().min(1).max(200),
  request: z.string().min(1).max(2000),
  constraints: z.string().max(2000).nullable(),
});
export type RoutineTemplate = z.infer<typeof routineTemplateSchema>;

/** True when the runtime can resolve the zone through Intl (no throw). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, { message: 'Unknown IANA time zone' });

export const routineSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  /** Weekly planning is project-scoped: notes and updates come from here. */
  projectId: z.string().min(1),
  timezone: timeZoneSchema,
  schedule: routineScheduleSchema,
  template: routineTemplateSchema,
  state: routineStateSchema,
  /**
   * Occurrences scheduled strictly before this instant are ignored: they
   * predate the routine (or its latest schedule edit), so enabling or
   * editing never back-fills a missed run.
   */
  windowStartAt: z.string().min(1),
  /** Local-date key of the latest occurrence a task was dispatched for. */
  lastOccurrenceKey: z.string().min(1).nullable(),
  lastOccurrenceAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Routine = z.infer<typeof routineSchema>;

export const createRoutineRequestSchema = z.strictObject({
  name: z.string().min(1).max(200),
  projectId: z.string().min(1),
  timezone: timeZoneSchema,
  schedule: routineScheduleSchema,
  template: routineTemplateSchema,
});
export type CreateRoutineRequest = z.infer<typeof createRoutineRequestSchema>;

export const updateRoutineRequestSchema = z
  .strictObject({
    name: z.string().min(1).max(200).optional(),
    projectId: z.string().min(1).optional(),
    timezone: timeZoneSchema.optional(),
    schedule: routineScheduleSchema.optional(),
    template: routineTemplateSchema.optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some((field) => field !== undefined),
    { message: 'At least one field is required' },
  );
export type UpdateRoutineRequest = z.infer<typeof updateRoutineRequestSchema>;

export const routineOccurrenceStateSchema = z.enum(['scheduled', 'missed', 'skipped']);
export type RoutineOccurrenceState = z.infer<typeof routineOccurrenceStateSchema>;

/**
 * One materialized occurrence of a routine. `occurrenceKey` is the scheduled
 * local calendar date (YYYY-MM-DD) in the routine's time zone; the pair
 * (routineId, occurrenceKey) is unique, which is what prevents duplicates
 * across ticks, restarts, clock changes, and DST transitions.
 */
export const routineOccurrenceSchema = z.strictObject({
  id: z.string().min(1),
  routineId: z.string().min(1),
  occurrenceKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** UTC ISO instant the occurrence was scheduled for. */
  scheduledFor: z.string().min(1),
  state: routineOccurrenceStateSchema,
  /** The dispatched weekly-plan task; its own state carries the outcome. */
  taskId: z.string().min(1).nullable(),
  /** Why a `missed` row exists (e.g. runtime unavailable past the grace). */
  reason: z.string().max(500).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** When the owner resolved a missed occurrence (run now or skip). */
  decidedAt: z.string().min(1).nullable(),
});
export type RoutineOccurrence = z.infer<typeof routineOccurrenceSchema>;

/**
 * Only missed occurrences take owner decisions: "run once now" (→ scheduled,
 * exactly one task) or "skip". A scheduled occurrence's outcome lives on its
 * task; skipped rows are terminal history.
 */
export const ROUTINE_OCCURRENCE_TRANSITIONS: Readonly<
  Record<RoutineOccurrenceState, readonly RoutineOccurrenceState[]>
> = {
  scheduled: [],
  missed: ['scheduled', 'skipped'],
  skipped: [],
};

export class InvalidRoutineOccurrenceTransitionError extends Error {
  constructor(
    public readonly from: RoutineOccurrenceState,
    public readonly to: RoutineOccurrenceState,
  ) {
    super(`Invalid routine occurrence transition: ${from} -> ${to}`);
    this.name = 'InvalidRoutineOccurrenceTransitionError';
  }
}

export function canTransitionRoutineOccurrence(
  from: RoutineOccurrenceState,
  to: RoutineOccurrenceState,
): boolean {
  return ROUTINE_OCCURRENCE_TRANSITIONS[from].includes(to);
}

/**
 * How late the runtime may execute a due occurrence before it becomes a
 * `missed` row for owner review instead of running automatically. Covers a
 * busy queue or a brief outage; a real unavailability interval surfaces one
 * reviewable occurrence — never an automatic replay burst.
 */
export const ROUTINE_LATE_GRACE_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Occurrence math. Pure millisecond-based functions over Intl so every
// consumer (scheduler, API, tests) shares one deterministic implementation.
// ---------------------------------------------------------------------------

export interface OccurrencePlan {
  /** Local calendar date (YYYY-MM-DD) of the scheduled occurrence. */
  key: string;
  /** UTC instant the occurrence happens at. */
  instantMs: number;
}

interface LocalWall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localWallOf(ms: number, zone: string): LocalWall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const by = new Map<string, string>();
  for (const part of parts) {
    by.set(part.type, part.value);
  }
  const hour = Number(by.get('hour'));
  return {
    year: Number(by.get('year')),
    month: Number(by.get('month')),
    day: Number(by.get('day')),
    // Intl renders midnight as 24 in some environments; normalize to 0.
    hour: hour === 24 ? 0 : hour,
    minute: Number(by.get('minute')),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function wallStringOf(wall: LocalWall): string {
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` +
    `T${pad(wall.hour)}:${pad(wall.minute)}`
  );
}

function localDayKeyOf(ms: number, zone: string): string {
  return wallStringOf(localWallOf(ms, zone)).slice(0, 10);
}

function addDaysToKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOfKey(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
}

/**
 * The UTC instant of a local wall time `wall` (YYYY-MM-DDTHH:mm) in `zone`:
 * - normal times resolve by offset probing (two iterations converge);
 * - ambiguous times (fall-back overlap) resolve to the FIRST pass;
 * - skipped times (spring-forward gap) resolve to the first minute after the
 *   gap, i.e. the occurrence still happens, at the transition.
 */
export function utcForWallTime(zone: string, wall: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const wallOf = (ms: number): string => {
    const parts = formatter.formatToParts(new Date(ms));
    const by = new Map<string, string>();
    for (const part of parts) {
      by.set(part.type, part.value);
    }
    const hour = Number(by.get('hour'));
    return (
      `${by.get('year')}-${by.get('month')}-${by.get('day')}` +
      `T${pad(hour === 24 ? 0 : hour)}:${by.get('minute')}`
    );
  };
  const anchor = Date.parse(`${wall}:00Z`);
  // Fast path: t = wall-as-UTC minus the zone offset at t. Converges for any
  // wall time that exists exactly once.
  const offsetAt = (ms: number): number => ms - Date.parse(`${wallOf(ms)}:00Z`);
  let guess = anchor - offsetAt(anchor);
  guess = anchor - offsetAt(guess);
  if (wallOf(guess) === wall) {
    // Modern offsets are minute-aligned; snap away sub-minute probe noise.
    return Math.floor(guess / 60_000) * 60_000;
  }
  // Slow path (DST gap or overlap): scan minute by minute. The wall clock is
  // not monotonic across a fall-back, so ordering can only be trusted by
  // walking forward: the first exact match is the first pass; if none ever
  // matches, the first minute past the target is the transition instant.
  const start = anchor - 16 * 3600_000;
  const end = anchor + 16 * 3600_000;
  let firstGreater: number | null = null;
  for (let t = start; t <= end; t += 60_000) {
    const current = wallOf(t);
    if (current === wall) {
      return t;
    }
    if (firstGreater === null && current > wall) {
      firstGreater = t;
    }
  }
  return firstGreater ?? end;
}

function matchesSchedule(schedule: RoutineSchedule, dayKey: string): boolean {
  return (
    schedule.kind === 'daily' || weekdayOfKey(dayKey) === schedule.weekday
  );
}

/**
 * The occurrence with the greatest scheduled instant at or before `nowMs`.
 * Null only for absurd clocks (nothing scheduled within the previous 8 days).
 */
export function latestOccurrenceAtOrBefore(
  nowMs: number,
  zone: string,
  schedule: RoutineSchedule,
): OccurrencePlan | null {
  const today = localDayKeyOf(nowMs, zone);
  for (let back = 0; back <= 8; back += 1) {
    const dayKey = addDaysToKey(today, -back);
    if (!matchesSchedule(schedule, dayKey)) {
      continue;
    }
    const instantMs = utcForWallTime(zone, `${dayKey}T${schedule.time}`);
    if (instantMs <= nowMs) {
      return { key: dayKey, instantMs };
    }
  }
  return null;
}

/** The first occurrence strictly after `nowMs`. Never null in practice. */
export function nextOccurrenceAfter(
  nowMs: number,
  zone: string,
  schedule: RoutineSchedule,
): OccurrencePlan | null {
  const today = localDayKeyOf(nowMs, zone);
  for (let forward = 0; forward <= 8; forward += 1) {
    const dayKey = addDaysToKey(today, forward);
    if (!matchesSchedule(schedule, dayKey)) {
      continue;
    }
    const instantMs = utcForWallTime(zone, `${dayKey}T${schedule.time}`);
    if (instantMs > nowMs) {
      return { key: dayKey, instantMs };
    }
  }
  return null;
}
