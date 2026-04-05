// ──────────────────────────────────────────────
// Walccy — Root Layout
// ──────────────────────────────────────────────

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useSettingsStore } from '../stores/settings.store';
import { wsClient } from '../services/ws-client';
import { useKeepScreenOn } from '../hooks/useKeepScreenOn';

// Keep the splash screen visible until fonts are ready (or we give up)
SplashScreen.preventAutoHideAsync().catch(() => {
  // preventAutoHideAsync can fail if the splash has already been hidden
});

// ── Font requires wrapped defensively ─────────
// The actual TTF files may not be present during early development.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fontMap: Record<string, any>;
try {
  fontMap = {
    'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
    'JetBrainsMono-Bold': require('../assets/fonts/JetBrainsMono-Bold.ttf'),
  };
} catch {
  fontMap = {};
}

// ── Inner layout — rendered inside all providers ──

function RootLayoutInner(): React.ReactElement {
  useKeepScreenOn();

  const [fontsLoaded] = useFonts(fontMap);

  // Hide the splash once fonts have loaded (or if there were no fonts to load)
  useEffect(() => {
    if (fontsLoaded || Object.keys(fontMap).length === 0) {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden — safe to ignore
      });
    }
  }, [fontsLoaded]);

  // Auto-reconnect to the last known host on mount
  useEffect(() => {
    const { savedHosts, lastConnectedHostId, autoReconnect } =
      useSettingsStore.getState();

    if (lastConnectedHostId && autoReconnect) {
      const host = savedHosts.find((h) => h.id === lastConnectedHostId);
      if (host) {
        SecureStore.getItemAsync(`secret_${host.id}`)
          .then((secret) => {
            if (secret) {
              wsClient.connect(host.host, host.port, secret);
            }
          })
          .catch((err: unknown) => {
            console.warn('[_layout] Auto-reconnect SecureStore error:', err);
          });
      }
    }
  }, []);

  // Don't block render on font loading — the app is fully functional without
  // the custom font (system monospace will be used as fallback by the terminal).

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}

// ── Root export ───────────────────────────────

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          <RootLayoutInner />
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
