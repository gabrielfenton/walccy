// ──────────────────────────────────────────────
// Walccy — PendingRequests
// Generic correlation map for request/response patterns over the WS link.
// Each entry has its own self-evicting timeout. Used for SPAWN_RESULT
// (keyed by requestId) and LIST_DIRECTORIES (single-flight, fixed key).
// ──────────────────────────────────────────────

interface Entry<T> {
  resolve: (val: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingRequests<T> {
  private map: Map<string, Entry<T>> = new Map();

  /**
   * Register a pending request. Returns the deferred promise plus its
   * resolver/rejector so the caller can attach the matching `requestId`
   * to whatever payload it sends out on the wire.
   */
  send<R extends T>(opts: {
    requestId: string;
    timeoutMs: number;
    onTimeout?: (id: string) => void;
  }): { promise: Promise<R>; resolve: (val: R) => void; reject: (err: Error) => void } {
    let resolveFn!: (val: R) => void;
    let rejectFn!: (err: Error) => void;

    const promise = new Promise<R>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const timer = setTimeout(() => {
      if (this.map.delete(opts.requestId)) {
        opts.onTimeout?.(opts.requestId);
        rejectFn(new Error(`Request ${opts.requestId} timed out`));
      }
    }, opts.timeoutMs);

    this.map.set(opts.requestId, {
      resolve: resolveFn as (val: T) => void,
      reject: rejectFn,
      timer,
    });

    return { promise, resolve: resolveFn, reject: rejectFn };
  }

  resolve(requestId: string, value: T): boolean {
    const entry = this.map.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.map.delete(requestId);
    entry.resolve(value);
    return true;
  }

  reject(requestId: string, err: Error): boolean {
    const entry = this.map.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.map.delete(requestId);
    entry.reject(err);
    return true;
  }

  rejectAll(err: Error): void {
    for (const [, entry] of Array.from(this.map.entries())) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.map.clear();
  }

  has(requestId: string): boolean {
    return this.map.has(requestId);
  }
}
