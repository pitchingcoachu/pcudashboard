import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from './programming-scope';
import { resolveOrganizationIdForSchool } from './training-db';

type PlayerContentSession = {
  email?: string;
  organizationId?: number;
  dashboardSchoolCode?: string | null;
  role?: string;
};

/**
 * Resolve notes and media against the currently selected dashboard site.
 * This intentionally fails closed instead of falling back to the login
 * account's organization when a selected school cannot be mapped.
 */
export async function resolvePlayerContentOrganizationId(session: PlayerContentSession): Promise<number> {
  const schoolCode = resolveProgrammingSchoolCode(session);
  const fallbackOrganizationId = await resolveProgrammingOrganizationId(session);
  return resolveOrganizationIdForSchool({
    schoolCode,
    fallbackOrganizationId,
    createIfMissing: false,
    allowFallbackIfUnresolved: false,
  });
}
