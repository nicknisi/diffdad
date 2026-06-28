/** SSE fan-out callback: push a named event + payload to every connected client. */
export type Broadcast = (event: string, data: unknown) => void;
