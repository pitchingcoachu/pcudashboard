export type SchoolBrand = {
  schoolCode: string;
  logoSrc: string | null;
  logoAlt: string;
  accent: string;
  accentSoft: string;
  accentRgb: string;
};

const DEFAULT_BRAND: SchoolBrand = {
  schoolCode: 'PCU',
  logoSrc: null,
  logoAlt: 'School logo',
  accent: '#c8102e',
  accentSoft: '#8f0f24',
  accentRgb: '200, 16, 46',
};

const SCHOOL_BRANDS: Record<string, SchoolBrand> = {
  OSU: {
    schoolCode: 'OSU',
    logoSrc: '/osu-logo.png',
    logoAlt: 'Oklahoma State logo',
    accent: '#ff7300',
    accentSoft: '#c45500',
    accentRgb: '255, 115, 0',
  },
  GCU: {
    schoolCode: 'GCU',
    logoSrc: '/gcu-logo.png',
    logoAlt: 'Grand Canyon logo',
    accent: '#522398',
    accentSoft: '#3b186f',
    accentRgb: '82, 35, 152',
  },
  LSU: {
    schoolCode: 'LSU',
    logoSrc: '/lsu-logo.png',
    logoAlt: 'LSU logo',
    accent: '#461d7c',
    accentSoft: '#2f1456',
    accentRgb: '70, 29, 124',
  },
  CNU: {
    schoolCode: 'CNU',
    logoSrc: '/cnu-logo.png',
    logoAlt: 'CNU logo',
    accent: '#f58220',
    accentSoft: '#c76410',
    accentRgb: '245, 130, 32',
  },
  SEMO: {
    schoolCode: 'SEMO',
    logoSrc: '/semo-logo.png',
    logoAlt: 'SEMO logo',
    accent: '#db1934',
    accentSoft: '#a31228',
    accentRgb: '219, 25, 52',
  },
  CREIGHTON: {
    schoolCode: 'CREIGHTON',
    logoSrc: '/creighton-logo.png',
    logoAlt: 'Creighton logo',
    accent: '#005ca9',
    accentSoft: '#00437a',
    accentRgb: '0, 92, 169',
  },
};

export function resolveSchoolBrand(schoolCode: string | null | undefined): SchoolBrand {
  const normalized = String(schoolCode ?? '')
    .trim()
    .toUpperCase();
  return SCHOOL_BRANDS[normalized] ?? { ...DEFAULT_BRAND, schoolCode: normalized || 'PCU' };
}

export function schoolBrandCssVars(schoolCode: string | null | undefined): Record<string, string> {
  const brand = resolveSchoolBrand(schoolCode);
  return {
    '--accent': brand.accent,
    '--accent-soft': brand.accentSoft,
    '--portal-accent-rgb': brand.accentRgb,
  } as Record<string, string>;
}
