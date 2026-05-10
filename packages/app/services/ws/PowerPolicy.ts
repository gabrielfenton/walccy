// ──────────────────────────────────────────────
// Walccy — PowerPolicy
// Reconciles the Android foreground service with the user's
// low-power-mode setting and the current connection state.
// ──────────────────────────────────────────────

interface ForegroundServiceLike {
  start: (p: { host: string; port: number }) => Promise<void>;
  stop: () => Promise<void>;
}

export interface PowerPolicyDeps {
  isLowPowerMode: () => boolean;
  foregroundService: ForegroundServiceLike;
}

export class PowerPolicy {
  private deps: PowerPolicyDeps;

  constructor(deps: PowerPolicyDeps) {
    this.deps = deps;
  }

  /** Call when (re)connecting with a host. Starts FG service unless low-power. */
  onConnect(host: string, port: number): void {
    if (this.deps.isLowPowerMode()) return;
    this.deps.foregroundService.start({ host, port }).catch((err) => {
      console.warn('[PowerPolicy] Foreground service start failed:', err);
    });
  }

  /** Call on disconnect. Always stops FG service. */
  onDisconnect(): void {
    this.deps.foregroundService.stop().catch(() => {});
  }

  /** Call when settings.lowPowerMode flips. Reconciles with current connection. */
  onPolicyChange(currentlyConnected: { host: string; port: number } | null): void {
    if (this.deps.isLowPowerMode()) {
      this.deps.foregroundService.stop().catch(() => {});
      return;
    }
    if (currentlyConnected) {
      this.deps.foregroundService
        .start({ host: currentlyConnected.host, port: currentlyConnected.port })
        .catch(() => {});
    }
  }
}
