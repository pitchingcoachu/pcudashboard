import { headers } from 'next/headers';

export const ACTIVITY_TRACKER_OWNER_EMAIL = 'jgaynor@pitchingcoachu.com';

export type PortalActivityEventType =
  | 'login_success'
  | 'page_view'
  | 'bullpen_saved'
  | 'hitting_saved'
  | 'workout_logged'
  | 'questionnaire_completed'
  | 'note_added'
  | 'media_uploaded';

export function canViewPortalActivity(input: { email?: string | null }): boolean {
  return String(input.email ?? '').trim().toLowerCase() === ACTIVITY_TRACKER_OWNER_EMAIL;
}

export function normalizeActivityEventType(value: string | null | undefined): PortalActivityEventType {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'login_success') return 'login_success';
  if (normalized === 'bullpen_saved') return 'bullpen_saved';
  if (normalized === 'hitting_saved') return 'hitting_saved';
  if (normalized === 'workout_logged') return 'workout_logged';
  if (normalized === 'questionnaire_completed') return 'questionnaire_completed';
  if (normalized === 'note_added') return 'note_added';
  if (normalized === 'media_uploaded') return 'media_uploaded';
  return 'page_view';
}

export async function readActivityRequestMeta(request?: Request): Promise<{ userAgent: string | null; ipAddress: string | null }> {
  const headerSource = request ? request.headers : await headers();
  const forwardedFor = headerSource.get('x-forwarded-for') ?? '';
  const ipAddress = forwardedFor.split(',')[0]?.trim() || headerSource.get('x-real-ip') || null;
  return {
    userAgent: headerSource.get('user-agent'),
    ipAddress,
  };
}
