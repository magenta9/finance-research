import type { PiStreamEvent } from './types';

export class PiEventBus {
  private readonly subscribers = new Set<(event: PiStreamEvent) => void>();

  subscribe(listener: (event: PiStreamEvent) => void) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  emit(event: PiStreamEvent) {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}
