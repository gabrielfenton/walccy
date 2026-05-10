// ──────────────────────────────────────────────
// Walccy — PingWatchdog
// Periodic heartbeat with a per-ping pong-timeout watchdog. Used to
// detect dead WS links faster than the OS-level keepalive (which can
// take minutes on cellular).
// ──────────────────────────────────────────────

export interface PingWatchdogOptions {
  interval: number;
  timeout: number;
  sendPing: () => void;
  onTimeout: () => void;
  isSocketOpen: () => boolean;
}

export class PingWatchdog {
  private opts: PingWatchdogOptions;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PingWatchdogOptions) {
    this.opts = opts;
  }

  start(): void {
    this.stop();
    this.intervalHandle = setInterval(() => this.tick(), this.opts.interval);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /** Caller is responsible for using `latencyMs` to update the UI. */
  notePongReceived(_latencyMs: number): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private tick(): void {
    if (!this.opts.isSocketOpen()) return;
    this.opts.sendPing();

    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      this.opts.onTimeout();
    }, this.opts.timeout);
  }
}
