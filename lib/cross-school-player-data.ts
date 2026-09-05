type CrossSchoolPlayerLink = {
  aliases: Set<string>;
  schoolCodes: Set<string>;
};

const LINKS: CrossSchoolPlayerLink[] = [
  {
    aliases: new Set(['tommypascanu', 'pascanutommy']),
    schoolCodes: new Set(['PCU', 'ARIZONA']),
  },
];

function normalizedNameKeys(value: string): Set<string> {
  const raw = String(value ?? '').trim();
  if (!raw) return new Set();
  const candidates = [raw];
  if (raw.includes(',')) {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) candidates.push([...parts.slice(1), parts[0]].join(' '));
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) candidates.push([...parts.slice(1), parts[0]].join(' '));
  }
  return new Set(candidates.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
}

export function isCrossSchoolPlayerSelection(schoolCode: string, playerSelection: string): boolean {
  const school = String(schoolCode ?? '').trim().toUpperCase();
  // Dashboard multi-selects use semicolons because a single display name can
  // legitimately contain a comma ("Last, First").
  const selectedNames = String(playerSelection ?? '').split(';').map((name) => name.trim()).filter(Boolean);
  if (selectedNames.length !== 1) return false;
  const keys = normalizedNameKeys(selectedNames[0]);
  return LINKS.some(
    (link) => link.schoolCodes.has(school) && Array.from(keys).some((key) => link.aliases.has(key))
  );
}
