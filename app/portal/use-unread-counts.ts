'use client';

import { useSyncExternalStore } from 'react';

type CounterStore = {
  endpoint: string;
  value: number;
  subscribers: Set<() => void>;
  timer: number | null;
  request: Promise<void> | null;
  visibilityHandler: (() => void) | null;
};

const POLL_INTERVAL_MS = 60_000;

function createCounterStore(endpoint: string): CounterStore {
  return { endpoint, value: 0, subscribers: new Set(), timer: null, request: null, visibilityHandler: null };
}

const messageStore = createCounterStore('/api/messaging/conversations?unreadOnly=1');
const notificationStore = createCounterStore('/api/portal/notifications?unreadOnly=1');

function notify(store: CounterStore) {
  for (const subscriber of store.subscribers) subscriber();
}

async function refresh(store: CounterStore) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (store.request) return store.request;
  store.request = (async () => {
    try {
      const response = await fetch(store.endpoint, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as { unreadCount?: number };
      const nextValue = Number(payload.unreadCount ?? 0) || 0;
      if (nextValue !== store.value) {
        store.value = nextValue;
        notify(store);
      }
    } catch {
      // Best effort. The next visible refresh will retry.
    }
  })().finally(() => { store.request = null; });
  return store.request;
}

function subscribe(store: CounterStore, callback: () => void) {
  store.subscribers.add(callback);
  if (store.subscribers.size === 1) {
    void refresh(store);
    store.timer = window.setInterval(() => void refresh(store), POLL_INTERVAL_MS);
    store.visibilityHandler = () => {
      if (document.visibilityState === 'visible') void refresh(store);
    };
    document.addEventListener('visibilitychange', store.visibilityHandler);
  }
  return () => {
    store.subscribers.delete(callback);
    if (store.subscribers.size > 0) return;
    if (store.timer !== null) window.clearInterval(store.timer);
    if (store.visibilityHandler) document.removeEventListener('visibilitychange', store.visibilityHandler);
    store.timer = null;
    store.visibilityHandler = null;
  };
}

function subscribeToMessages(callback: () => void) { return subscribe(messageStore, callback); }
function subscribeToNotifications(callback: () => void) { return subscribe(notificationStore, callback); }
function getMessageSnapshot() { return messageStore.value; }
function getNotificationSnapshot() { return notificationStore.value; }
function getServerSnapshot() { return 0; }

export function useUnreadMessageCount(): number {
  return useSyncExternalStore(subscribeToMessages, getMessageSnapshot, getServerSnapshot);
}

export function useUnreadNotificationCount(): number {
  return useSyncExternalStore(subscribeToNotifications, getNotificationSnapshot, getServerSnapshot);
}

export function setUnreadNotificationCount(value: number) {
  notificationStore.value = Math.max(0, Number(value) || 0);
  notify(notificationStore);
}

export function refreshUnreadMessageCount() {
  return refresh(messageStore);
}
