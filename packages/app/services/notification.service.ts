// ──────────────────────────────────────────────
// Walccy — Notification service (Phase 2 stub)
// Full push notification logic is future work.
// ──────────────────────────────────────────────

import * as Notifications from 'expo-notifications';

// Configure default notification handler so foreground notifications show
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Request notification permissions from the OS.
 * Returns `true` if granted, `false` otherwise.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a local notification to appear immediately.
 */
export async function scheduleLocalNotification(
  title: string,
  body: string
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
    },
    trigger: null, // deliver immediately
  });
}
