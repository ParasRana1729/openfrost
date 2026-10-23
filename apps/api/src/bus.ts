import { EventEmitter } from 'node:events';
import type { Event } from '@openfrost/domain';

/** In-process fan-out of appended activity events to authenticated SSE streams. */
export class EventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(100);
  }

  publish(event: Event): void {
    this.#emitter.emit('activity', event);
  }

  subscribe(listener: (event: Event) => void): () => void {
    this.#emitter.on('activity', listener);
    return () => this.#emitter.off('activity', listener);
  }
}
