import type { SseDataFor, SseEventName } from '@diffdad/contracts';

/**
 * SSE fan-out callback: push a named event + payload to every connected client. Typed against the
 * `SseEvent` union so every emission is checked at compile time — the event name must be one of the
 * union's discriminants and `data` must match that event's payload.
 */
export type Broadcast = <E extends SseEventName>(event: E, data: SseDataFor<E>) => void;
