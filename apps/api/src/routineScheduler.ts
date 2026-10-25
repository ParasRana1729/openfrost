import {
  ROUTINE_LATE_GRACE_MS,
  canTransitionRoutineOccurrence,
  InvalidRoutineOccurrenceTransitionError,
  latestOccurrenceAtOrBefore,
  type Routine,
  type RoutineOccurrence,
} from '@openfrost/domain';
import {
  RoutineNotFoundError,
  RoutineOccurrenceExistsError,
  RoutineOccurrenceNotFoundError,
  type Store,
} from '@openfrost/db';
import type { TaskExecutor } from '@openfrost/agent';

export interface RoutineSchedulerOptions {
  store: Store;
  executor: TaskExecutor;
  /** Single source of time; both the ISO string and its ms value derive from it. */
  now: () => string;
  /** Tick cadence for start(); tests drive tick() directly instead. */
  intervalMs?: number;
}

export interface TickResult {
  /** Occurrences dispatched to a task this tick. */
  scheduled: number;
  /** Occurrences recorded missed (runtime unavailable past the grace). */
  missed: number;
}

/**
 * The routine tick (spec §7: "one task worker, routine tick"). Runs in the
 * API process with no browser involved. Each tick examines, per active
 * routine, only the LATEST occurrence at or before now:
 *
 * - already materialized → nothing (dedup across ticks/restarts/clock jumps,
 *   keyed by the stable local-date occurrence key);
 * - due within the late grace → dispatch one weekly_plan task through the
 *   global executor (queue + limits apply);
 * - later than that (the runtime was unavailable, paused, or the schedule
 *   changed underneath) → exactly ONE `missed` row for owner review with
 *   "run once now" / "skip". Older occurrences are never replayed.
 *
 * Occurrences scheduled before the routine's windowStartAt (creation or last
 * schedule edit) are ignored entirely — enabling a routine never back-fills.
 */
export class RoutineScheduler {
  readonly #store: Store;
  readonly #executor: TaskExecutor;
  readonly #now: () => string;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;

  constructor(options: RoutineSchedulerOptions) {
    this.#store = options.store;
    this.#executor = options.executor;
    this.#now = options.now;
    this.#intervalMs = options.intervalMs ?? 30_000;
  }

  /** Starts the periodic tick. The timer is unref'd: it never keeps the
   * process alive on its own, and stop() always cancels it. */
  start(): void {
    if (this.#timer !== null) {
      return;
    }
    const run = (): void => {
      void this.tick().catch(() => {
        // Tick failures must never crash the runtime; the next tick retries.
        // A store-level failure leaves no occurrence row, so nothing dedups
        // wrongly — the same occurrence is simply re-examined next tick.
      });
    };
    this.#timer = setInterval(run, this.#intervalMs);
    this.#timer.unref?.();
    run();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  nowMs(): number {
    return Date.parse(this.#now());
  }

  /** Examines every active routine once. Safe to call repeatedly. */
  async tick(): Promise<TickResult> {
    const result: TickResult = { scheduled: 0, missed: 0 };
    const now = this.#now();
    const nowMs = Date.parse(now);
    for (const routine of this.#store.routines.listByState('active')) {
      const latest = latestOccurrenceAtOrBefore(nowMs, routine.timezone, routine.schedule);
      if (latest === null || latest.instantMs < Date.parse(routine.windowStartAt)) {
        // Nothing due yet under this schedule (or the clock predates it).
        continue;
      }
      const existing = this.#store.routines.getOccurrence(routine.id, latest.key);
      if (existing !== null) {
        continue;
      }
      const latenessMs = nowMs - latest.instantMs;
      if (latenessMs <= ROUTINE_LATE_GRACE_MS) {
        try {
          await this.#dispatch(routine, latest.key, new Date(latest.instantMs).toISOString(), now);
          result.scheduled += 1;
        } catch (err) {
          if (err instanceof RoutineOccurrenceExistsError) {
            // A concurrent tick (same process race) already materialized it.
            continue;
          }
          throw err;
        }
      } else {
        this.#store.routines.createOccurrence(
          {
            routineId: routine.id,
            occurrenceKey: latest.key,
            scheduledFor: new Date(latest.instantMs).toISOString(),
            state: 'missed',
            reason:
              'The runtime was not available within the grace window of the ' +
              `scheduled time (${new Date(latest.instantMs).toISOString()}).`,
          },
          now,
        );
        this.#store.events.append(
          'routine.occurrence_missed',
          {
            payload: {
              routineId: routine.id,
              occurrenceKey: latest.key,
              scheduledFor: new Date(latest.instantMs).toISOString(),
            },
          },
          now,
        );
        result.missed += 1;
      }
    }
    return result;
  }

  /** Owner chose "run once now" on a missed occurrence: one task, once. */
  async runMissedNow(routineId: string, occurrenceKey: string): Promise<RoutineOccurrence> {
    const routine = this.#requireRoutine(routineId);
    const occurrence = this.#store.routines.getOccurrence(routineId, occurrenceKey);
    if (occurrence === null) {
      throw new RoutineOccurrenceNotFoundError(routineId, occurrenceKey);
    }
    if (!canTransitionRoutineOccurrence(occurrence.state, 'scheduled')) {
      // Only a missed occurrence can be run now; duplicates must 409.
      throw new InvalidRoutineOccurrenceTransitionError(occurrence.state, 'scheduled');
    }
    const task = await this.#executor.enqueueRoutineOccurrence({
      routine,
      occurrenceKey,
      scheduledFor: occurrence.scheduledFor,
    });
    const resolved = this.#store.routines.resolveOccurrence(
      routineId,
      occurrenceKey,
      'scheduled',
      { taskId: task.id },
      this.#now(),
    );
    this.#store.events.append(
      'routine.occurrence_run_now',
      {
        taskId: task.id,
        payload: { routineId, occurrenceKey, taskId: task.id },
      },
      this.#now(),
    );
    return resolved;
  }

  /** Owner chose "skip": the missed occurrence becomes terminal history. */
  skipMissed(routineId: string, occurrenceKey: string): RoutineOccurrence {
    this.#requireRoutine(routineId);
    const occurrence = this.#store.routines.resolveOccurrence(
      routineId,
      occurrenceKey,
      'skipped',
      {},
      this.#now(),
    );
    this.#store.events.append(
      'routine.occurrence_skipped',
      { payload: { routineId, occurrenceKey } },
      this.#now(),
    );
    return occurrence;
  }

  async #dispatch(
    routine: Routine,
    occurrenceKey: string,
    scheduledFor: string,
    now: string,
  ): Promise<void> {
    // Row first, then task: the unique (routineId, key) index is the dedup
    // barrier. If the enqueue fails after the row exists, the occurrence
    // stays 'scheduled' without a task — visible in the routine's history,
    // and never silently duplicated on the next tick.
    this.#store.routines.createOccurrence(
      {
        routineId: routine.id,
        occurrenceKey,
        scheduledFor,
        state: 'scheduled',
      },
      now,
    );
    const task = await this.#executor.enqueueRoutineOccurrence({
      routine,
      occurrenceKey,
      scheduledFor,
    });
    this.#store.routines.setOccurrenceTask(routine.id, occurrenceKey, task.id, now);
    this.#store.routines.update(
      routine.id,
      { lastOccurrenceKey: occurrenceKey, lastOccurrenceAt: scheduledFor },
      now,
    );
    this.#store.events.append(
      'routine.occurrence_scheduled',
      {
        taskId: task.id,
        payload: { routineId: routine.id, occurrenceKey, scheduledFor, taskId: task.id },
      },
      now,
    );
  }

  #requireRoutine(routineId: string): Routine {
    const routine = this.#store.routines.get(routineId);
    if (routine === null) {
      throw new RoutineNotFoundError(routineId);
    }
    return routine;
  }
}
