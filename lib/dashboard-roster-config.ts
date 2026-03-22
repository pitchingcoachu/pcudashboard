import fs from 'node:fs';

function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

function extractRVector(text: string, key: string): string[] {
  const pattern = new RegExp(`${key}\\s*=\\s*c\\(([\\s\\S]*?)\\)`, 'm');
  const match = text.match(pattern);
  if (!match) return [];
  const block = match[1] ?? '';
  const quoted = Array.from(block.matchAll(/"([^"]+)"/g)).map((entry) => String(entry[1] ?? '').trim());
  return uniqueNames(quoted);
}

export function loadRosterVectorsFromConfig(schoolCode: string): { allowedPitchers: string[]; allowedHitters: string[] } | null {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (!upper) return null;
  const envKey = `DASHBOARD_SCHOOL_CONFIG_PATH_${upper}`;
  const envPath = String(process.env[envKey] ?? '').trim();
  const bundledRoot = process.cwd();
  const defaultPathBySchool: Record<string, string> = {
    OSU: `${bundledRoot}/dashboard_api/config/schools/OSU/school_config.R`,
    PCU: `${bundledRoot}/dashboard_api/config/schools/PCU/school_config.R`,
    CNU: `${bundledRoot}/dashboard_api/config/schools/CNU/school_config.R`,
    GCU: `${bundledRoot}/dashboard_api/config/schools/GCU/school_config.R`,
    LSU: `${bundledRoot}/dashboard_api/config/schools/LSU/school_config.R`,
    SEMO: `${bundledRoot}/dashboard_api/config/schools/SEMO/school_config.R`,
  };
  const configPath = envPath || defaultPathBySchool[upper] || '';
  if (!configPath || !fs.existsSync(configPath)) return null;
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const base = {
      allowedPitchers: extractRVector(text, 'allowed_pitchers'),
      allowedHitters: extractRVector(text, 'allowed_hitters'),
    };
    if (upper === 'PCU') {
      const additions = ['Heather, Connor', 'Carr, Jordan', 'King, Stan', 'Jones, Grady', 'Birt, Henry'];
      return {
        allowedPitchers: uniqueNames([...base.allowedPitchers, ...additions]),
        allowedHitters: uniqueNames([...base.allowedHitters, ...additions]),
      };
    }
    return base;
  } catch {
    return null;
  }
}

export function filterNamesByAllowed(values: string[], allowed: string[]): string[] {
  const cleanedValues = uniqueNames(values);
  const cleanedAllowed = uniqueNames(allowed);
  if (!cleanedAllowed.length) return cleanedValues;
  const allowedLower = new Set(cleanedAllowed.map((entry) => entry.toLowerCase()));
  return cleanedValues.filter((entry) => allowedLower.has(entry.toLowerCase()));
}

export function appendRosterNames(values: string[], additions: string[]): string[] {
  return uniqueNames([...values, ...additions]);
}

export function schoolRosterAdditions(schoolCode: string): { pitchers: string[]; hitters: string[] } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PCU') {
    return {
      pitchers: ['Heather, Connor', 'Carr, Jordan', 'King, Stan', 'Jones, Grady', 'Birt, Henry'],
      hitters: ['King, Stan', 'Jones, Grady', 'Birt, Henry'],
    };
  }
  return { pitchers: [], hitters: [] };
}
