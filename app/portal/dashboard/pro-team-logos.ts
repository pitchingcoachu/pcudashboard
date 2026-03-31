const MLB_TEAM_ID_BY_CODE: Record<string, number> = {
  ARI: 109,
  ATL: 144,
  BAL: 110,
  BOS: 111,
  CHC: 112,
  CWS: 145,
  CIN: 113,
  CLE: 114,
  COL: 115,
  DET: 116,
  HOU: 117,
  KC: 118,
  LAA: 108,
  LAD: 119,
  MIA: 146,
  MIL: 158,
  MIN: 142,
  NYM: 121,
  NYY: 147,
  ATH: 133,
  PHI: 143,
  PIT: 134,
  SD: 135,
  SF: 137,
  SEA: 136,
  STL: 138,
  TB: 139,
  TEX: 140,
  TOR: 141,
  WSH: 120,
};

const TEAM_CODE_ALIASES: Record<string, string> = {
  AZ: 'ARI',
  OAK: 'ATH',
  CHW: 'CWS',
  LV: 'LAS',
  NFK: 'NOR',
  SCR: 'SWB',
  SLB: 'SLC',
  SL: 'SLC',
};

const AAA_PARENT_BY_CODE: Record<string, string> = {
  ABQ: 'COL',
  BUF: 'TOR',
  CHA: 'CWS',
  CLT: 'TB',
  COL: 'CLE',
  DUR: 'TB',
  ELP: 'SD',
  GWN: 'ATL',
  IND: 'PIT',
  IOW: 'CHC',
  JAX: 'MIA',
  LAS: 'ATH',
  LHV: 'PHI',
  LOU: 'CIN',
  MEM: 'STL',
  NAS: 'MIL',
  NOR: 'BAL',
  OKC: 'LAD',
  OMA: 'KC',
  RCH: 'WSH',
  RNO: 'ARI',
  ROC: 'WSH',
  RR: 'TEX',
  SAC: 'SF',
  SA: 'SD',
  SLC: 'LAA',
  SUG: 'HOU',
  STP: 'MIN',
  SWB: 'NYY',
  SYR: 'NYM',
  TAC: 'SEA',
  TOL: 'DET',
  WOR: 'BOS',
};

const AAA_CODE_BY_NAME: Record<string, string> = {
  'round rock express': 'RR',
  'salt lake bees': 'SLC',
};

const MLB_CODE_BY_FULL_NAME: Record<string, string> = {
  'arizona diamondbacks': 'ARI',
  'atlanta braves': 'ATL',
  'baltimore orioles': 'BAL',
  'boston red sox': 'BOS',
  'chicago cubs': 'CHC',
  'chicago white sox': 'CWS',
  'cincinnati reds': 'CIN',
  'cleveland guardians': 'CLE',
  'colorado rockies': 'COL',
  'detroit tigers': 'DET',
  'houston astros': 'HOU',
  'kansas city royals': 'KC',
  'los angeles angels': 'LAA',
  'los angeles dodgers': 'LAD',
  'miami marlins': 'MIA',
  'milwaukee brewers': 'MIL',
  'minnesota twins': 'MIN',
  'new york mets': 'NYM',
  'new york yankees': 'NYY',
  'athletics': 'ATH',
  'philadelphia phillies': 'PHI',
  'pittsburgh pirates': 'PIT',
  'san diego padres': 'SD',
  'san francisco giants': 'SF',
  'seattle mariners': 'SEA',
  'st. louis cardinals': 'STL',
  'tampa bay rays': 'TB',
  'texas rangers': 'TEX',
  'toronto blue jays': 'TOR',
  'washington nationals': 'WSH',
};

const MLB_FULL_NAME_BY_CODE: Record<string, string> = {
  AZ: 'Arizona Diamondbacks',
  ARI: 'Arizona Diamondbacks',
  ATL: 'Atlanta Braves',
  BAL: 'Baltimore Orioles',
  BOS: 'Boston Red Sox',
  CHC: 'Chicago Cubs',
  CWS: 'Chicago White Sox',
  CIN: 'Cincinnati Reds',
  CLE: 'Cleveland Guardians',
  COL: 'Colorado Rockies',
  DET: 'Detroit Tigers',
  HOU: 'Houston Astros',
  KC: 'Kansas City Royals',
  LAA: 'Los Angeles Angels',
  LAD: 'Los Angeles Dodgers',
  MIA: 'Miami Marlins',
  MIL: 'Milwaukee Brewers',
  MIN: 'Minnesota Twins',
  NYM: 'New York Mets',
  NYY: 'New York Yankees',
  ATH: 'Athletics',
  OAK: 'Athletics',
  PHI: 'Philadelphia Phillies',
  PIT: 'Pittsburgh Pirates',
  SD: 'San Diego Padres',
  SF: 'San Francisco Giants',
  SEA: 'Seattle Mariners',
  STL: 'St. Louis Cardinals',
  TB: 'Tampa Bay Rays',
  TEX: 'Texas Rangers',
  TOR: 'Toronto Blue Jays',
  WSH: 'Washington Nationals',
};

const AAA_FULL_NAME_BY_CODE: Record<string, string> = {
  ABQ: 'Albuquerque Isotopes (COL)',
  BUF: 'Buffalo Bisons (TOR)',
  CHA: 'Charlotte Knights (CWS)',
  CLT: 'Charlotte Knights (CWS)',
  COL: 'Columbus Clippers (CLE)',
  DUR: 'Durham Bulls (TB)',
  ELP: 'El Paso Chihuahuas (SD)',
  GWN: 'Gwinnett Stripers (ATL)',
  IND: 'Indianapolis Indians (PIT)',
  IOW: 'Iowa Cubs (CHC)',
  JAX: 'Jacksonville Jumbo Shrimp (MIA)',
  LAS: 'Las Vegas Aviators (ATH)',
  LHV: 'Lehigh Valley IronPigs (PHI)',
  LOU: 'Louisville Bats (CIN)',
  MEM: 'Memphis Redbirds (STL)',
  NAS: 'Nashville Sounds (MIL)',
  NOR: 'Norfolk Tides (BAL)',
  OKC: 'Oklahoma City Comets (LAD)',
  OMA: 'Omaha Storm Chasers (KC)',
  RNO: 'Reno Aces (AZ)',
  ROC: 'Rochester Red Wings (WSH)',
  RR: 'Round Rock Express (TEX)',
  SAC: 'Sacramento River Cats (SF)',
  SA: 'San Antonio Missions (SD)',
  SLC: 'Salt Lake Bees (LAA)',
  STP: 'St. Paul Saints (MIN)',
  SUG: 'Sugar Land Space Cowboys (HOU)',
  SWB: 'Scranton/Wilkes-Barre RailRiders (NYY)',
  SYR: 'Syracuse Mets (NYM)',
  TAC: 'Tacoma Rainiers (SEA)',
  TOL: 'Toledo Mud Hens (DET)',
  WOR: 'Worcester Red Sox (BOS)',
};

function normalizeCode(teamCode: string | null | undefined): string {
  const raw = String(teamCode ?? '').trim().toUpperCase();
  if (!raw) return '';
  return TEAM_CODE_ALIASES[raw] ?? raw;
}

export function inferProTeamCode(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all') return '';
  const parenCode = raw.match(/\(([A-Za-z0-9_]+)\)\s*$/)?.[1];
  const direct = normalizeCode(parenCode || raw);
  if (direct && (MLB_TEAM_ID_BY_CODE[direct] || AAA_PARENT_BY_CODE[direct])) return direct;
  const byAaaName = AAA_CODE_BY_NAME[raw.toLowerCase()];
  if (byAaaName) return byAaaName;
  const byName = MLB_CODE_BY_FULL_NAME[raw.toLowerCase()];
  if (byName) return byName;
  return '';
}

export function getProTeamLogoUrl(teamCode: string | null | undefined): string {
  const normalized = inferProTeamCode(teamCode);
  if (!normalized) return '';
  const mlbCode = MLB_TEAM_ID_BY_CODE[normalized] ? normalized : AAA_PARENT_BY_CODE[normalized];
  if (!mlbCode) return '';
  const teamId = MLB_TEAM_ID_BY_CODE[mlbCode];
  if (!teamId) return '';
  const useDarkCapVariant = new Set([
    'CWS',
    'DET',
    'NYY',
    'SD',
    'COL',
    'ATH',
    'MIN',
    'MIA',
    'TEX',
    'STL',
    'ATL',
    'TB',
    'KC',
  ]);
  if (useDarkCapVariant.has(mlbCode)) {
    return `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${teamId}.svg`;
  }
  return `https://www.mlbstatic.com/team-logos/team-cap-on-light/${teamId}.svg`;
}

export function getProTeamDisplayName(
  value: string | null | undefined,
  preferredLevel: 'MLB' | 'AAA' | 'All' = 'All'
): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all') return raw || 'All';
  const code = inferProTeamCode(raw);
  if (!code) return raw;
  const normalized = normalizeCode(code);
  if (preferredLevel === 'MLB') {
    return MLB_FULL_NAME_BY_CODE[normalized] ?? AAA_FULL_NAME_BY_CODE[normalized] ?? raw;
  }
  if (preferredLevel === 'AAA') {
    return AAA_FULL_NAME_BY_CODE[normalized] ?? MLB_FULL_NAME_BY_CODE[normalized] ?? raw;
  }
  return MLB_FULL_NAME_BY_CODE[normalized] ?? AAA_FULL_NAME_BY_CODE[normalized] ?? raw;
}
