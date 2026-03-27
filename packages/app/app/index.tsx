// ──────────────────────────────────────────────
// Walccy — Entry redirect
// Sends the user to the terminal if they have a
// previously connected host, or to the connect
// screen if this is a fresh install / first run.
// ──────────────────────────────────────────────

import React from 'react';
import { Redirect } from 'expo-router';
import { useSettingsStore } from '../stores/settings.store';

export default function Index(): React.ReactElement | null {
  const lastConnectedHostId = useSettingsStore((s) => s.lastConnectedHostId);

  if (lastConnectedHostId) {
    return <Redirect href="/terminal/no-session" />;
  }

  return <Redirect href="/connect" />;
}
