// ──────────────────────────────────────────────
// Walccy — useKeepScreenOn hook
// Activates expo-keep-awake when connected and the
// keepScreenOn setting is enabled.
// ──────────────────────────────────────────────

import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useConnectionStore } from '../stores/connection.store';
import { useSettingsStore } from '../stores/settings.store';

const KEEP_AWAKE_TAG = 'walccy-screen-on';

export function useKeepScreenOn(): void {
  const status = useConnectionStore((s) => s.status);
  const keepScreenOn = useSettingsStore((s) => s.keepScreenOn);

  useEffect(() => {
    const shouldKeepOn = keepScreenOn && status === 'connected';

    if (shouldKeepOn) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch((err: unknown) => {
        console.warn('[useKeepScreenOn] activateKeepAwakeAsync failed:', err);
      });
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }

    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepScreenOn, status]);
}
