export type SchoolBrand = {
  schoolCode: string;
  logoSrc: string | null;
  logoAlt: string;
  accent: string;
  accentSoft: string;
  accentRgb: string;
  accentRgbSecondary?: string;
};

const DEFAULT_BRAND: SchoolBrand = {
  schoolCode: 'PCU',
  logoSrc: '/pearl-clam-transparent.png',
  logoAlt: 'Pearl Player Development',
  accent: '#dcc1a1',
  accentSoft: '#ffffff',
  accentRgb: '220, 193, 161',
  accentRgbSecondary: '255, 255, 255',
};

const SCHOOL_BRANDS: Record<string, SchoolBrand> = {
  PCU: {
    schoolCode: 'PCU',
    logoSrc: '/pitching-coach-u-logo.png',
    logoAlt: 'Pitching Coach U logo',
    accent: '#c8102e',
    accentSoft: '#8f0f24',
    accentRgb: '200, 16, 46',
    accentRgbSecondary: '200, 16, 46',
  },
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
  TRIAL: {
    schoolCode: 'TRIAL',
    logoSrc: '/pearl-clam-transparent.png',
    logoAlt: 'Pearl Player Development',
    accent: '#dcc1a1',
    accentSoft: '#ffffff',
    accentRgb: '220, 193, 161',
    accentRgbSecondary: '255, 255, 255',
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
  UNOH: {
    schoolCode: 'UNOH',
    logoSrc: '/unoh-logo.png',
    logoAlt: 'University of Northwestern Ohio logo',
    accent: '#891f1a',
    accentSoft: '#641713',
    accentRgb: '137, 31, 26',
    accentRgbSecondary: '255, 255, 255',
  },
  LEC: {
    schoolCode: 'LEC',
    logoSrc: '/lec-logo.png',
    logoAlt: 'Lake Erie College logo',
    accent: '#004f3d',
    accentSoft: '#00382c',
    accentRgb: '0, 79, 61',
    accentRgbSecondary: '255, 255, 255',
  },
  LEAGUE: {
    schoolCode: 'LEAGUE',
    logoSrc: '/ncaa-logo.png',
    logoAlt: 'NCAA',
    accent: '#00A3E0',
    accentSoft: '#0077B6',
    accentRgb: '0, 163, 224',
    accentRgbSecondary: '0, 163, 224',
  },
  PRO: {
    schoolCode: 'PRO',
    logoSrc: '/mlb-logo.png',
    logoAlt: 'MLB',
    accent: '#041e42',
    accentSoft: '#02152f',
    accentRgb: '4, 30, 66',
    accentRgbSecondary: '4, 30, 66',
  },
};

export const SCHOOL_BRAND_CODES = Object.freeze(Object.keys(SCHOOL_BRANDS));

export function resolveSchoolBrand(schoolCode: string | null | undefined): SchoolBrand {
  const normalized = String(schoolCode ?? '')
    .trim()
    .toUpperCase();
  return SCHOOL_BRANDS[normalized] ?? { ...DEFAULT_BRAND, schoolCode: normalized || 'PCU' };
}

// Unlike resolveSchoolBrand (which always returns something, falling back to
// the default Pearl Player Development brand for any unrecognized code),
// this tells callers whether a code is a REAL known brand -- needed anywhere
// "no brand match" must mean "unknown" rather than silently substituting the
// default brand's name/logo as if it were a real answer.
export function isKnownSchoolBrand(schoolCode: string | null | undefined): boolean {
  const normalized = String(schoolCode ?? '')
    .trim()
    .toUpperCase();
  return normalized in SCHOOL_BRANDS;
}

export function schoolBrandCssVars(schoolCode: string | null | undefined): Record<string, string> {
  const brand = resolveSchoolBrand(schoolCode);
  const hex = brand.accent.replace('#', '');
  const channels = hex.length === 3
    ? hex.split('').map((value) => Number.parseInt(`${value}${value}`, 16))
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((value) => Number.parseInt(value, 16));
  const luminance = channels
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  return {
    '--accent': brand.accent,
    '--accent-soft': brand.accentSoft,
    '--portal-accent-rgb': brand.accentRgb,
    '--portal-accent-rgb-secondary': brand.accentRgbSecondary ?? brand.accentRgb,
    '--portal-accent-contrast': luminance > 0.179 ? '#08090a' : '#ffffff',
  } as Record<string, string>;
}
