import { gameTrackerErrorResponse, requireGameTrackerAccess } from '../../../../lib/game-tracker/access';
import {
  createGameTrackerTeam,
  linkGameTrackerPersonToPlayer,
  listGameTrackerTeams,
  removeGameTrackerRosterMember,
  saveGameTrackerRosterMember,
} from '../../../../lib/game-tracker/db';
import { trackerTeamActionSchema } from '../../../../lib/game-tracker/validation';
import type { Handedness, ThrowingHand } from '../../../../lib/game-tracker/types';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field.trim()); field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], names: string[]): number {
  return headers.findIndex((header) => names.includes(header.toLowerCase().replace(/[^a-z0-9]/g, '')));
}

export async function GET(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request);
    return Response.json(await listGameTrackerTeams(access.organizationId, access.schoolCode));
  } catch (error) { return gameTrackerErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const input = trackerTeamActionSchema.parse(await request.json());
    if (input.action === 'create_team') {
      return Response.json({ team: await createGameTrackerTeam({ ...input, organizationId: access.organizationId }) }, { status: 201 });
    }
    if (input.action === 'save_member') {
      return Response.json({ member: await saveGameTrackerRosterMember({ ...input, organizationId: access.organizationId }) });
    }
    if (input.action === 'link_person') {
      return Response.json(await linkGameTrackerPersonToPlayer({ ...input, organizationId: access.organizationId }));
    }

    const rows = parseCsv(input.csvText);
    if (rows.length < 2) throw new Error('CSV needs a header row and at least one player.');
    const headers = rows[0];
    const nameIndex = headerIndex(headers, ['name', 'player', 'playername', 'fullname']);
    if (nameIndex < 0) throw new Error('CSV needs a Name or Player column.');
    const batsIndex = headerIndex(headers, ['bats', 'bathand', 'batterhand']);
    const throwsIndex = headerIndex(headers, ['throws', 'throwshand', 'pitcherhand']);
    const positionIndex = headerIndex(headers, ['position', 'pos']);
    const jerseyIndex = headerIndex(headers, ['jersey', 'jerseynumber', 'number']);
    const playerIdIndex = headerIndex(headers, ['playerid', 'pcuplayerid']);
    let imported = 0;
    for (const row of rows.slice(1)) {
      const displayName = row[nameIndex]?.trim();
      if (!displayName) continue;
      const batsRaw = row[batsIndex]?.trim().toUpperCase();
      const throwsRaw = row[throwsIndex]?.trim().toUpperCase();
      await saveGameTrackerRosterMember({
        organizationId: access.organizationId,
        teamId: input.teamId,
        playerId: playerIdIndex >= 0 && Number(row[playerIdIndex]) > 0 ? Number(row[playerIdIndex]) : null,
        displayName,
        bats: (['R', 'L', 'S'].includes(batsRaw) ? batsRaw : 'R') as Handedness,
        throws: (['R', 'L'].includes(throwsRaw) ? throwsRaw : 'R') as ThrowingHand,
        position: positionIndex >= 0 ? row[positionIndex] || null : null,
        jerseyNumber: jerseyIndex >= 0 ? row[jerseyIndex] || null : null,
      });
      imported += 1;
    }
    return Response.json({ imported });
  } catch (error) { return gameTrackerErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const access = await requireGameTrackerAccess(request, true);
    const params = new URL(request.url).searchParams;
    return Response.json(await removeGameTrackerRosterMember({
      organizationId: access.organizationId,
      teamId: Number(params.get('teamId')),
      memberId: Number(params.get('memberId')),
    }));
  } catch (error) { return gameTrackerErrorResponse(error); }
}
