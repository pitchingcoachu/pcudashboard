type MessagingSession = {
  email?: string | null;
  role?: string | null;
};

export const COMPANY_MESSAGING_OWNER_EMAIL = 'jgaynor@pitchingcoachu.com';

export function isCompanyMessagingOwner(session: MessagingSession): boolean {
  return session.role === 'admin' && String(session.email ?? '').trim().toLowerCase() === COMPANY_MESSAGING_OWNER_EMAIL;
}
