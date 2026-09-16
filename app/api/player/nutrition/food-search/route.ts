import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { foodDatabaseConfigured, searchFoods } from '../../../../../lib/food-database-api';

// Any logged-in player/coach session may search -- no playerId-specific
// access check needed since search results carry no player data, only a
// proxy call to keep the USDA API key server-side (Open Food Facts needs no key).
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!foodDatabaseConfigured()) return NextResponse.json({ configured: false, results: [] });

  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';
  if (!query.trim()) return NextResponse.json({ configured: true, results: [] });

  try {
    const results = await searchFoods(query, 20);
    return NextResponse.json({ configured: true, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Food search failed.' }, { status: 502 });
  }
}
