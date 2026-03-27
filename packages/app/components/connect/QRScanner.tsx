// ──────────────────────────────────────────────
// Walccy — QRScanner
// Full-screen camera view with QR scanning.
// Validates parsed JSON before calling onScanned.
// ──────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors } from '../../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../../constants/typography';

// ── Types ─────────────────────────────────────

export interface PairingData {
  v: number;
  host: string;
  port: number;
  secret: string;
  label: string;
}

export interface QRScannerProps {
  onScanned: (data: PairingData) => void;
  onCancel: () => void;
}

// ── Helpers ───────────────────────────────────

const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;
const SCAN_BOX_SIZE = 240;

function parsePairingData(raw: string): PairingData | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj['v'] !== 'number' ||
      typeof obj['host'] !== 'string' ||
      typeof obj['port'] !== 'number' ||
      typeof obj['secret'] !== 'string' ||
      typeof obj['label'] !== 'string'
    ) {
      return null;
    }

    return {
      v:      obj['v'] as number,
      host:   obj['host'] as string,
      port:   obj['port'] as number,
      secret: obj['secret'] as string,
      label:  obj['label'] as string,
    };
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────

export const QRScanner: React.FC<QRScannerProps> = ({ onScanned, onCancel }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  // Request permission on mount if not yet determined
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      // Guard: only process the first successful scan
      if (scannedRef.current) return;

      const pairing = parsePairingData(data);
      if (!pairing) return;

      scannedRef.current = true;
      onScanned(pairing);
    },
    [onScanned]
  );

  // ── Permission denied state ────────────────

  if (!permission) {
    // Still loading permission status
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Requesting camera access…</Text>
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Camera access required</Text>
          <Text style={styles.permissionText}>
            Allow camera access to scan the QR code from{' '}
            <Text style={styles.mono}>walccy pair</Text>.
          </Text>

          {permission.canAskAgain ? (
            <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonText}>Grant Access</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.primaryButtonText}>Open Settings</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.ghostButton} onPress={onCancel}>
            <Text style={styles.ghostButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Camera view ───────────────────────────

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      {/* Dark overlay with cut-out */}
      <View style={styles.overlay}>
        {/* Top dark band */}
        <View style={styles.overlayBand} />

        {/* Middle row: dark | clear | dark */}
        <View style={styles.overlayRow}>
          <View style={styles.overlaySide} />

          {/* Scan box with corner markers */}
          <View style={[styles.scanBox, { width: SCAN_BOX_SIZE, height: SCAN_BOX_SIZE }]}>
            {/* Top-left */}
            <View style={[styles.corner, styles.cornerTopLeft]} />
            {/* Top-right */}
            <View style={[styles.corner, styles.cornerTopRight]} />
            {/* Bottom-left */}
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            {/* Bottom-right */}
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>

          <View style={styles.overlaySide} />
        </View>

        {/* Bottom band with instruction + cancel */}
        <View style={[styles.overlayBand, styles.overlayBottom]}>
          <Text style={styles.instructionText}>
            Point at the QR code shown by <Text style={styles.mono}>walccy pair</Text>
          </Text>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            activeOpacity={0.8}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

// ── Styles ────────────────────────────────────

const OVERLAY_COLOR = 'rgba(0,0,0,0.6)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Permission screen ─────────────────────

  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },

  permissionTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.semiBold,
    textAlign: 'center',
  },

  permissionText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
    lineHeight: 22,
  },

  mono: {
    fontFamily: FontFamily.mono,
    color: Colors.textPrimary,
  },

  primaryButton: {
    marginTop: 8,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },

  ghostButton: {
    height: 44,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ghostButtonText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },

  // ── Overlay ───────────────────────────────

  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },

  overlayBand: {
    flex: 1,
    backgroundColor: OVERLAY_COLOR,
  },

  overlayRow: {
    flexDirection: 'row',
    height: SCAN_BOX_SIZE,
  },

  overlaySide: {
    flex: 1,
    backgroundColor: OVERLAY_COLOR,
  },

  overlayBottom: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 48,
    gap: 20,
  },

  scanBox: {
    // transparent cut-out
  },

  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#FFFFFF',
  },

  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 4,
  },

  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 4,
  },

  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 4,
  },

  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 4,
  },

  instructionText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
    paddingHorizontal: 32,
  },

  cancelButton: {
    height: 48,
    paddingHorizontal: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  cancelButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
});
