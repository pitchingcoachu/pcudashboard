'use client';

import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type Token } from '@capacitor/push-notifications';
import { useEffect } from 'react';

const DEVICE_TOKEN_STORAGE_KEY = 'pearl_apns_device_token';

function notificationPath(action: ActionPerformed): string | null {
  const data = action.notification.data as Record<string, unknown> | undefined;
  const nested = data?.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : null;
  const path = String(data?.path ?? nested?.path ?? '').trim();
  if (path.startsWith('/portal')) return path;

  const conversationId = Number(data?.conversationId ?? nested?.conversationId ?? 0);
  if (Number.isFinite(conversationId) && conversationId > 0) return `/portal/messages/${conversationId}`;

  const type = String(data?.type ?? nested?.type ?? '').trim();
  if (type === 'workout_assigned' || type === 'exercise_assigned') return '/portal/player';
  if (type === 'plan_target_reached') return '/portal/player/program';
  if (type === 'video_export_complete') return '/portal/settings';
  return null;
}

async function saveToken(token: Token): Promise<void> {
  const deviceToken = String(token.value ?? '').trim();
  if (!deviceToken) return;
  const response = await fetch('/api/mobile/push-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken, provider: 'apns', platform: 'ios' }),
  });
  if (response.ok) window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, deviceToken);
}

/** Removes this physical device from the signed-in account before logout. */
export async function unregisterNativePushDevice(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;
  const deviceToken = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  if (deviceToken) {
    await fetch('/api/mobile/push-tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken }),
    }).catch(() => {});
    window.localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
  }
  await PushNotifications.unregister().catch(() => {});
}

export default function NativePushRegistration() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void (async () => {
      handles.push(await PushNotifications.addListener('registration', (token) => {
        if (!cancelled) void saveToken(token);
      }));
      handles.push(await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const path = notificationPath(action);
        if (path) window.location.assign(path);
      }));

      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
      if (!cancelled && permission.receive === 'granted') await PushNotifications.register();
    })().catch(() => {
      // Registration is best-effort; login and normal portal use must continue.
    });

    return () => {
      cancelled = true;
      for (const handle of handles) void handle.remove();
    };
  }, []);

  return null;
}
