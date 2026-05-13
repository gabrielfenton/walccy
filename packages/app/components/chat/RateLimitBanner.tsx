// ──────────────────────────────────────────────
// RateLimitBanner — surfaces the latest `rate_limit` event per session
// ──────────────────────────────────────────────
//
// The daemon forwards SDK rate-limit transitions verbatim. We render two
// states: `allowed_warning` (amber pill, soft tone) and `rejected` (red
// bar, no input until reset). Anything else collapses to null so the
// banner only takes space when there's something to say.
//
// Reset time is formatted as a short countdown so the user can decide
// whether to wait or top up. Updates every 30s while mounted — that's
// the same cadence the SDK retransmits rate_limit events at, so we
// avoid burning a render loop just to tick seconds.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMessagesStore } from '../../stores/messages.store';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';

interface RateLimitBannerProps {
  sessionId: string;
}

function formatResetCountdown(resetsAtMs: number): string {
  const deltaSec = Math.max(0, Math.round((resetsAtMs - Date.now()) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) {
    const m = Math.floor(deltaSec / 60);
    return `${m}m`;
  }
  const h = Math.floor(deltaSec / 3600);
  const m = Math.floor((deltaSec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function RateLimitBanner({
  sessionId,
}: RateLimitBannerProps): React.ReactElement | null {
  const info = useMessagesStore((s) => s.buffers[sessionId]?.rateLimit);
  const [, force] = useState(0);

  // 30 s tick so the countdown moves while the banner is mounted.
  useEffect(() => {
    if (!info?.resetsAt) return;
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [info?.resetsAt]);

  if (!info) return null;
  if (info.status === 'allowed') return null;

  const isRejected = info.status === 'rejected';
  const countdown = info.resetsAt ? formatResetCountdown(info.resetsAt) : null;
  const kind = isRejected ? 'rejected' : 'warning';

  const label = isRejected
    ? 'Rate limited'
    : 'Approaching rate limit';

  return (
    <View style={[styles.row, isRejected ? styles.rowRejected : styles.rowWarning]}>
      <View style={[styles.dot, isRejected ? styles.dotRejected : styles.dotWarning]} />
      <Text style={[styles.label, isRejected ? styles.labelRejected : styles.labelWarning]}>
        {label}
      </Text>
      {info.rateLimitType ? (
        <Text style={styles.detail} numberOfLines={1}>
          · {info.rateLimitType}
        </Text>
      ) : null}
      {countdown ? (
        <Text style={styles.detail}>· resets in {countdown}</Text>
      ) : null}
      {kind === 'warning' && typeof info.utilization === 'number' ? (
        <Text style={styles.detail}>
          · {Math.round(info.utilization * 100)}%
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  rowRejected: {
    backgroundColor: Colors.accentRed + '22',
    borderBottomWidth: 1,
    borderBottomColor: Colors.accentRed + '66',
  },
  rowWarning: {
    backgroundColor: Colors.accentAmber + '22',
    borderBottomWidth: 1,
    borderBottomColor: Colors.accentAmber + '66',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotRejected: { backgroundColor: Colors.accentRed },
  dotWarning:  { backgroundColor: Colors.accentAmber },
  label: {
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.semiBold,
  },
  labelRejected: { color: Colors.accentRed },
  labelWarning:  { color: Colors.accentAmber },
  detail: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
  },
});
