import type { ResearchStreamEvent } from '@quantdesk/shared';

export class ResearchEventBus {
    private readonly listeners = new Set<(event: ResearchStreamEvent) => void>();

    emit(event: ResearchStreamEvent) {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    subscribe(listener: (event: ResearchStreamEvent) => void) {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }
}