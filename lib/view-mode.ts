import { cookies } from 'next/headers';
import { VIEW_MODE_COOKIE, type ViewMode } from './view-mode-shared';

export { VIEW_MODE_COOKIE, type ViewMode };

export async function resolveViewMode(): Promise<ViewMode> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(VIEW_MODE_COOKIE)?.value;
  return raw === 'desktop' ? 'desktop' : 'auto';
}
