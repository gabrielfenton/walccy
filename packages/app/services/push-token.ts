// ──────────────────────────────────────────────
// Walccy — Push token helper
// Gets the Expo push token for FCM registration.
// ──────────────────────────────────────────────

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

/**
 * Gets the native push token (FCM for Android, APNs for iOS).
 * Returns null if not available (simulator, permissions denied, etc.)
 */
export async function getPushToken(): Promise<{
  token: string;
  platform: 'android' | 'ios';
} | null> {
  // Push tokens only work on physical devices
  if (!Device.isDevice) {
    console.warn('[push-token] Not a physical device — skipping');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[push-token] Notification permission not granted');
    return null;
  }

  // Set up Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('walccy-sessions', {
      name: 'Session Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  try {
    // Get the native device push token (FCM token on Android)
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    return { token: tokenData.data, platform };
  } catch (err) {
    console.warn('[push-token] Failed to get push token:', err);
    return null;
  }
}
