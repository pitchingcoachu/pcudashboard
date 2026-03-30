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
  HARVARD: {
    schoolCode: 'HARVARD',
    logoSrc: '/harvard-logo.png',
    logoAlt: 'Harvard logo',
    accent: '#a51c30',
    accentSoft: '#781421',
    accentRgb: '165, 28, 48',
  },
  CBU: {
    schoolCode: 'CBU',
    logoSrc: '/cbu-logo.webp',
    logoAlt: 'CBU logo',
    accent: '#002554',
    accentSoft: '#001f3f',
    accentRgb: '0, 37, 84',
  },
  GMU: {
    schoolCode: 'GMU',
    logoSrc: '/gmu-logo.png',
    logoAlt: 'GMU logo',
    accent: '#105135',
    accentSoft: '#0b3b27',
    accentRgb: '16, 81, 53',
  },
  UNM: {
    schoolCode: 'UNM',
    logoSrc: '/unm-logo.png',
    logoAlt: 'UNM logo',
    accent: '#ba0c2f',
    accentSoft: '#8b0923',
    accentRgb: '186, 12, 47',
  },
  LEAGUE: {
    schoolCode: 'LEAGUE',
    logoSrc: null,
    logoAlt: 'League',
    accent: '#c8102e',
    accentSoft: '#8f0f24',
    accentRgb: '200, 16, 46',
  },
  PRO: {
    schoolCode: 'PRO',
    logoSrc: '/mlb-logo.png',
    logoAlt: 'MLB',
    accent: '#041e42',
    accentSoft: '#02152f',
    accentRgb: '4, 30, 66',
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
