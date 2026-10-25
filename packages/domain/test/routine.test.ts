import { describe, expect, it } from 'vitest';
import {
  ROUTINE_LATE_GRACE_MS,
  ROUTINE_OCCURRENCE_TRANSITIONS,
  InvalidRoutineOccurrenceTransitionError,
  canTransitionRoutineOccurrence,
  createRoutineRequestSchema,
  isValidTimeZone,
  latestOccurrenceAtOrBefore,
  nextOccurrenceAfter,
  routineOccurrenceSchema,
  routineScheduleSchema,
  routineSchema,
  utcForWallTime,
  type Routine,
} from '../src/index.js';

const NOW = '2026-10-23T12:00:00.000Z';

function sampleRoutine(overrides: Partial<Routine> = {}): Routine {
  return routineSchema.parse({
    id: 'routine-1',
    name: 'Friday planning',
    projectId: 'project-1',
    timezone: 'UTC',
    schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
    template: {
      title: 'Draft next week priorities',
      request: 'Review this project notes and recent updates; draft next week priorities.',
      constraints: null,
    },
    state: 'paused',
    windowStartAt: NOW,
    lastOccurrenceKey: null,
    lastOccurrenceAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

/** 2026-10-23 is a Friday; 09:00 UTC that day. */
const FRIDAY_0900_UTC = Date.parse('2026-10-23T09:00:00.000Z');

describe('routine schema', () => {
  it('accepts a valid routine and validates weekly schedules', () => {
    const routine = sampleRoutine();
    expect(routine.schedule).toEqual({ kind: 'weekly', weekday: 5, time: '09:00' });
  });

  it('accepts a daily schedule', () => {
    const schedule = routineScheduleSchema.parse({ kind: 'daily', time: '08:30' });
    expect(schedule).toEqual({ kind: 'daily', time: '08:30' });
  });

  it('rejects malformed times, weekdays, and zones', () => {
    expect(() => routineScheduleSchema.parse({ kind: 'daily', time: '24:00' })).toThrowError();
    expect(() => routineScheduleSchema.parse({ kind: 'daily', time: '9:00' })).toThrowError();
    expect(() =>
      routineScheduleSchema.parse({ kind: 'weekly', weekday: 7, time: '09:00' }),
    ).toThrowError();
    expect(() => sampleRoutine({ timezone: 'Mars/Olympus' })).toThrowError();
  });

  it('validates the time zone through Intl', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });

  it('create request requires the full reviewed template', () => {
    expect(() =>
      createRoutineRequestSchema.parse({
        name: 'Friday planning',
        projectId: 'project-1',
        timezone: 'UTC',
        schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
        template: { title: 'Plan', request: 'Plan the week', constraints: null },
      }),
    ).not.toThrowError();
    expect(() =>
      createRoutineRequestSchema.parse({
        name: 'x',
        projectId: 'p',
        timezone: 'UTC',
        schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
        template: { title: '', request: 'Plan the week', constraints: null },
      }),
    ).toThrowError();
  });
});

describe('routine occurrence schema', () => {
  it('accepts a valid occurrence', () => {
    expect(() =>
      routineOccurrenceSchema.parse({
        id: 'occ-1',
        routineId: 'routine-1',
        occurrenceKey: '2026-10-23',
        scheduledFor: '2026-10-23T09:00:00.000Z',
        state: 'scheduled',
        taskId: 'task-1',
        reason: null,
        createdAt: NOW,
        updatedAt: NOW,
        decidedAt: null,
      }),
    ).not.toThrowError();
  });

  it('rejects keys that are not local dates', () => {
    expect(() =>
      routineOccurrenceSchema.parse({
        id: 'occ-1',
        routineId: 'routine-1',
        occurrenceKey: '2026-10-23T09:00:00Z',
        scheduledFor: '2026-10-23T09:00:00.000Z',
        state: 'missed',
        taskId: null,
        reason: 'runtime unavailable',
        createdAt: NOW,
        updatedAt: NOW,
        decidedAt: null,
      }),
    ).toThrowError();
  });

  it('only missed occurrences can transition, to scheduled or skipped', () => {
    expect(ROUTINE_OCCURRENCE_TRANSITIONS.missed).toEqual(['scheduled', 'skipped']);
    expect(ROUTINE_OCCURRENCE_TRANSITIONS.scheduled).toEqual([]);
    expect(ROUTINE_OCCURRENCE_TRANSITIONS.skipped).toEqual([]);
    expect(canTransitionRoutineOccurrence('missed', 'scheduled')).toBe(true);
    expect(canTransitionRoutineOccurrence('missed', 'skipped')).toBe(true);
    expect(canTransitionRoutineOccurrence('scheduled', 'skipped')).toBe(false);
    expect(
      new InvalidRoutineOccurrenceTransitionError('scheduled', 'skipped').message,
    ).toContain('scheduled -> skipped');
  });

  it('exposes a positive late grace', () => {
    expect(ROUTINE_LATE_GRACE_MS).toBeGreaterThan(0);
  });
});

describe('occurrence math', () => {
  const weeklyFriday9 = { kind: 'weekly', weekday: 5, time: '09:00' } as const;
  const daily9 = { kind: 'daily', time: '09:00' } as const;

  it('finds the latest weekly occurrence at or before now', () => {
    // Saturday after the Friday 09:00 occurrence.
    const now = Date.parse('2026-10-24T12:00:00.000Z');
    const latest = latestOccurrenceAtOrBefore(now, 'UTC', weeklyFriday9);
    expect(latest).toEqual({ key: '2026-10-23', instantMs: FRIDAY_0900_UTC });
  });

  it('falls back to the previous week before the time of day', () => {
    // Friday 08:59 UTC: this week has not happened yet.
    const now = Date.parse('2026-10-23T08:59:00.000Z');
    const latest = latestOccurrenceAtOrBefore(now, 'UTC', weeklyFriday9);
    expect(latest?.key).toBe('2026-10-16');
  });

  it('includes an occurrence happening exactly now', () => {
    const latest = latestOccurrenceAtOrBefore(FRIDAY_0900_UTC, 'UTC', weeklyFriday9);
    expect(latest?.instantMs).toBe(FRIDAY_0900_UTC);
  });

  it('finds the next occurrence strictly after now', () => {
    const next = nextOccurrenceAfter(FRIDAY_0900_UTC, 'UTC', weeklyFriday9);
    expect(next).toEqual({ key: '2026-10-30', instantMs: Date.parse('2026-10-30T09:00:00.000Z') });
  });

  it('handles daily cadences', () => {
    const now = Date.parse('2026-10-23T10:00:00.000Z');
    expect(latestOccurrenceAtOrBefore(now, 'UTC', daily9)?.key).toBe('2026-10-23');
    expect(nextOccurrenceAfter(now, 'UTC', daily9)?.key).toBe('2026-10-24');
  });

  it('converts a zone wall time to the right UTC instant', () => {
    // America/New_York is UTC-4 in October 2026 (EDT).
    expect(utcForWallTime('America/New_York', '2026-10-23T09:00')).toBe(
      Date.parse('2026-10-23T13:00:00.000Z'),
    );
    // …and UTC+2 in Berlin in late October 2026 (CEST, before Oct 25).
    expect(utcForWallTime('Europe/Berlin', '2026-10-23T09:00')).toBe(
      Date.parse('2026-10-23T07:00:00.000Z'),
    );
  });

  it('resolves ambiguous fall-back wall times to the first pass', () => {
    // America/New_York leaves DST on 2026-11-01 at 02:00 EDT → 01:00 EST;
    // 01:30 happens twice. The first pass is 05:30 UTC (EDT, -4).
    const instant = utcForWallTime('America/New_York', '2026-11-01T01:30');
    expect(instant).toBe(Date.parse('2026-11-01T05:30:00.000Z'));
    // The occurrence key stays the local date regardless of the transition.
    const latest = latestOccurrenceAtOrBefore(
      Date.parse('2026-11-01T06:00:00.000Z'),
      'America/New_York',
      { kind: 'daily', time: '01:30' },
    );
    expect(latest?.key).toBe('2026-11-01');
  });

  it('schedules spring-forward gap times at the first instant after the gap', () => {
    // America/New_York enters DST on 2027-03-14 at 02:00 EST → 03:00 EDT;
    // 02:30 never happens. The occurrence runs when the clock reaches 03:00.
    const instant = utcForWallTime('America/New_York', '2027-03-14T02:30');
    expect(instant).toBe(Date.parse('2027-03-14T07:00:00.000Z'));
    // Its local wall time after the jump is 03:00, but the occurrence key
    // remains the local date the schedule named.
    const latest = latestOccurrenceAtOrBefore(
      Date.parse('2027-03-14T07:30:00.000Z'),
      'America/New_York',
      { kind: 'daily', time: '02:30' },
    );
    expect(latest?.key).toBe('2027-03-14');
  });

  it('keys occurrences by local date across a DST shift', () => {
    // Weekly Friday 09:00 in New York across the 2026-11-01 transition:
    // Oct 30 is EDT (-4), Nov 6 is EST (-5). Different UTC instants for the
    // same wall time, but distinct stable local-date keys.
    const before = latestOccurrenceAtOrBefore(
      Date.parse('2026-10-30T14:00:00.000Z'),
      'America/New_York',
      weeklyFriday9,
    );
    const after = latestOccurrenceAtOrBefore(
      Date.parse('2026-11-06T15:00:00.000Z'),
      'America/New_York',
      weeklyFriday9,
    );
    expect(before).toEqual({ key: '2026-10-30', instantMs: Date.parse('2026-10-30T13:00:00.000Z') });
    expect(after).toEqual({ key: '2026-11-06', instantMs: Date.parse('2026-11-06T14:00:00.000Z') });
  });
});
