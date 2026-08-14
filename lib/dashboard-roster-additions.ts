function uniqueNames(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

export function appendRosterNames(values: string[], additions: string[]): string[] {
  return uniqueNames([...values, ...additions]);
}

export function schoolRosterAdditions(schoolCode: string): { pitchers: string[]; hitters: string[] } {
  const upper = String(schoolCode ?? '').trim().toUpperCase();
  if (upper === 'PCU') {
    return {
      pitchers: ['Heather, Connor', 'Carr, Jordan', 'King, Stan', 'Jones, Grady', 'Birt, Henry', 'Clark, Hunter', 'Luna, Cael', 'Rodriguez, Diego', 'Jensen, Tyler', 'Liguori, Luke', 'Masi, Jack', 'Jacobs, Brody', 'Stevenson, Townsend', 'Bates, Tyler', 'Povich, Cade', 'Seremak, Finn', 'Hicks, Jackson'],
      hitters: ['King, Stan', 'Jones, Grady', 'Birt, Henry', 'Seremak, Finn', 'Hicks, Jackson'],
    };
  }
  return { pitchers: [], hitters: [] };
}
