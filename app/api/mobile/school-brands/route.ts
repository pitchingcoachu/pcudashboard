import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/auth';
import { resolveSchoolBrand, SCHOOL_BRAND_CODES } from '../../../../lib/school-brand';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromRequest(request, cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requestUrl = new URL(request.url);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;

  const brands = SCHOOL_BRAND_CODES.map((schoolCode) => {
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
