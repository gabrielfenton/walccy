// ──────────────────────────────────────────────
// Walccy — ReconnectController
// Owns reconnect lifecycle: backoff + jitter, offline parking, and
// circuit-break after too many consecutive failures.
// ──────────────────────────────────────────────

export interface ReconnectConfig {
  delays: number[];
  jitter: number;
  maxAttempts: number;
  isOnline: () => boolean;
  onceOnline: (cb: () => void) => void;
  openSocket: () => void;
  setStatus: (status: 'connecting' | 'error') => void;
  onCircuitBreak: () => void;
}

export class ReconnectController {
  private cfg: ReconnectConfig;
  private _attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _circuitBroken = false;

  constructor(cfg: ReconnectConfig) {
    this.cfg = cfg;
  }

  schedule(): void {
    this.cancel();

    if (!this.cfg.isOnline()) {
      // Park until network returns. UI shows "connecting" so user knows
      // we haven't given up.
      this.cfg.setStatus('connecting');
      this.cfg.onceOnline(() => {
        this.reset();
        this.cfg.openSocket();
      });
      return;
    }

    if (this._attempt >= this.cfg.maxAttempts) {
      this._circuitBroken = true;
      this.cfg.onCircuitBreak();
      return;
    }

    const delays = this.cfg.delays;
    const base = delays[Math.min(this._attempt, delays.length - 1)] ?? delays[delays.length - 1]!;
    const jitter = base * this.cfg.jitter * (Math.random() * 2 - 1);
    const delay = Math.max(500, Math.round(base + jitter));
    this._attempt++;

    this.cfg.setStatus('connecting');
    this.timer = setTimeout(() => {
      this.timer = null;
      this.cfg.openSocket();
    }, delay);
  }

  /** Call after a successful AUTH_OK so the next disconnect retries fast. */
  reset(): void {
    this._attempt = 0;
    this._circuitBroken = false;
    this.cancel();
  }

  /** Cancel any pending scheduled attempt. Does not reset attempt count. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get attempt(): number {
    return this._attempt;
  }

  get circuitBroken(): boolean {
    return this._circuitBroken;
  }
}
