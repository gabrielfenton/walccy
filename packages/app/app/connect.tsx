// ──────────────────────────────────────────────
// Walccy — Connect Screen
// Entry point for pairing with a walccy daemon.
// Supports QR scanning and manual entry.
// ──────────────────────────────────────────────

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '../constants/colors';
import { FontFamily, FontSize, FontWeight } from '../constants/typography';
import { useSettingsStore } from '../stores/settings.store';
import { wsClient } from '../services/ws-client';
import { QRScanner, type PairingData } from '../components/connect/QRScanner';
import { SavedHostList } from '../components/connect/SavedHostList';
import { ManualConnectForm } from '../components/connect/ManualConnectForm';
import type { SavedHost } from '../stores/settings.store';

// ── Component ─────────────────────────────────

export default function ConnectScreen(): React.ReactElement {
  const savedHosts = useSettingsStore((s) => s.savedHosts);
  const addHost = useSettingsStore((s) => s.addHost);
  const removeHost = useSettingsStore((s) => s.removeHost);
  const setLastConnected = useSettingsStore((s) => s.setLastConnected);

  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // ── Connect helpers ──────────────────────────

  async function saveAndConnect(
    label: string,
    host: string,
    port: number,
    secret: string
  ): Promise<void> {
    setConnecting(true);

    try {
      // Persist the host (without the secret)
      const savedHost = addHost({ label, host, port });

      // Store the secret separately in the secure keychain
      await SecureStore.setItemAsync(`secret_${savedHost.id}`, secret);

      // Mark as the last connected host
      setLastConnected(savedHost.id);

      // Initiate WebSocket connection
      wsClient.connect(host, port, secret);

      // Navigate into the terminal
      router.replace('/terminal/no-session');
    } catch (err) {
      console.warn('[ConnectScreen] saveAndConnect error:', err);
      setConnecting(false);
    }
  }

  async function reconnectToHost(host: SavedHost): Promise<void> {
    setConnecting(true);

    try {
      const secret = await SecureStore.getItemAsync(`secret_${host.id}`);
      if (!secret) {
        // Secret missing — fall back to manual entry
        setConnecting(false);
        setShowManualForm(true);
        return;
      }

      setLastConnected(host.id);
      wsClient.connect(host.host, host.port, secret);
      router.replace('/terminal/no-session');
    } catch (err) {
      console.warn('[ConnectScreen] reconnectToHost error:', err);
      setConnecting(false);
    }
  }

  // ── QR scan handler ──────────────────────────

  function handleQRScanned(data: PairingData): void {
    setShowQRScanner(false);
    saveAndConnect(data.label, data.host, data.port, data.secret);
  }

  // ── Manual form handler ──────────────────────

  function handleManualConnect(
    label: string,
    host: string,
    port: number,
    secret: string
  ): void {
    setShowManualForm(false);
    saveAndConnect(label, host, port, secret);
  }

  // ── Full-screen QR scanner ───────────────────

  if (showQRScanner) {
    return (
      <QRScanner
        onScanned={handleQRScanned}
        onCancel={() => setShowQRScanner(false)}
      />
    );
  }

  // ── Main screen ───────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>Walccy</Text>
          <Text style={styles.title}>Connect to your machine</Text>
          <Text style={styles.subtitle}>
            Scan the QR code from{' '}
            <Text style={styles.mono}>walccy pair</Text>
          </Text>
        </View>

        {/* QR Scan button */}
        <TouchableOpacity
          style={styles.qrButton}
          onPress={() => setShowQRScanner(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Scan QR Code"
        >
          <Text style={styles.qrButtonIcon}>📷</Text>
          <Text style={styles.qrButtonText}>Scan QR Code</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or connect manually</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Saved hosts section */}
        {savedHosts.length > 0 && (
          <View style={styles.savedHostsSection}>
            <Text style={styles.sectionTitle}>Recent</Text>
            <View style={styles.savedHostsContainer}>
              <SavedHostList
                hosts={savedHosts}
                onSelectHost={reconnectToHost}
                onDeleteHost={(id) => removeHost(id)}
              />
            </View>
          </View>
        )}

        {/* Add manually button */}
        <TouchableOpacity
          style={styles.manualButton}
          onPress={() => setShowManualForm(true)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Add manually"
        >
          <Text style={styles.manualButtonText}>+ Add manually</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Manual connect form — bottom-sheet style modal */}
      <Modal
        visible={showManualForm}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowManualForm(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Connect manually</Text>
          </View>
          <ManualConnectForm
            onConnect={handleManualConnect}
            onCancel={() => setShowManualForm(false)}
          />
        </View>
      </Modal>

      {/* Connecting spinner overlay */}
      {connecting && (
        <View style={styles.spinnerOverlay}>
          <View style={styles.spinnerCard}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.spinnerText}>Connecting…</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },

  // ── Header ────────────────────────────────

  header: {
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 32,
    gap: 8,
  },

  logo: {
    color: Colors.accent,
    fontFamily: FontFamily.ui,
    fontSize: 24,
    fontWeight: FontWeight.bold,
  },

  title: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.title,
    fontWeight: FontWeight.semiBold,
    textAlign: 'center',
  },

  subtitle: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    textAlign: 'center',
  },

  mono: {
    fontFamily: FontFamily.mono,
    color: Colors.textPrimary,
  },

  // ── QR Button ─────────────────────────────

  qrButton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 0,
  },

  qrButtonIcon: {
    fontSize: 20,
  },

  qrButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.semiBold,
  },

  // ── Divider ───────────────────────────────

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    gap: 12,
  },

  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },

  dividerText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
  },

  // ── Saved hosts ───────────────────────────

  savedHostsSection: {
    marginBottom: 16,
    gap: 8,
  },

  sectionTitle: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.caption,
    fontWeight: FontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },

  savedHostsContainer: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },

  // ── Manual button ─────────────────────────

  manualButton: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },

  manualButtonText: {
    color: Colors.textSecondary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },

  // ── Manual form modal ─────────────────────

  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  modalHeader: {
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
  },

  modalTitle: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.heading,
    fontWeight: FontWeight.semiBold,
  },

  // ── Spinner overlay ───────────────────────

  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  spinnerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    minWidth: 140,
  },

  spinnerText: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.ui,
    fontSize: FontSize.body,
    fontWeight: FontWeight.medium,
  },
});
