import { deleteDevicePushToken, listDevicePushTokensForUsers } from './training-db';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_TOKENS_PER_REQUEST = 100;

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Sends a push notification to every registered device for the given users.
 * Best-effort: failures are swallowed (the caller's write already succeeded;
 * a missed push shouldn't fail the request), but tokens Expo reports as
 * DeviceNotRegistered are pruned so they stop being retried.
 */
export async function sendPushNotificationToUsers(input: {
  userIds: number[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    const tokens = await listDevicePushTokensForUsers(input.userIds);
    if (tokens.length === 0) return;

    for (const batch of chunk(tokens, MAX_TOKENS_PER_REQUEST)) {
      const messages: ExpoPushMessage[] = batch.map((to) => ({
        to,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
      }));

      const response = await fetch(EXPO_PUSH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) continue;

      const payload = (await response.json().catch(() => null)) as { data?: ExpoPushTicket[] } | null;
      const tickets = Array.isArray(payload?.data) ? payload!.data : [];
      await Promise.all(
        tickets.map(async (ticket, index) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            await deleteDevicePushToken(batch[index]).catch(() => {});
          }
        })
      );
    }
  } catch {
    // Best-effort: never let a push failure surface to the caller.
  }
}
