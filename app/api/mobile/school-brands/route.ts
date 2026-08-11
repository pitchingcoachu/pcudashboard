import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveSchoolBrand } from '../../../../lib/school-brand';

// Schools mobile currently renders with distinct branding. Any other school
// code falls back to default Pearl branding client-side -- same fallback
// behavior as resolveSchoolBrand() already has on web.
const MOBILE_BRANDED_SCHOOL_CODES = ['OSU', 'LSU', 'HARVARD', 'UNOH', 'LEAGUE', 'PRO'];

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requestUrl = new URL(request.url);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;

  const brands = MOBILE_BRANDED_SCHOOL_CODES.map((schoolCode) => {
    const brand = resolveSchoolBrand(schoolCode);
    return {
      schoolCode: brand.schoolCode,
      accent: brand.accent,
      accentSoft: brand.accentSoft,
      logoUrl: brand.logoSrc ? `${origin}${brand.logoSrc}` : null,
    };
  });

  return NextResponse.json({ brands });
}
