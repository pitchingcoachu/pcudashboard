import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { analyzePulseCsv, importPulseFile, validatePulseFiles } from '../../../../lib/pulse-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SCHOOL_CODE = 'ARIZONA';

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isAuthorized(request: Request): boolean {
  const expected = String(process.env.ARIZONA_PULSE_SYNC_TOKEN ?? '').trim();
  if (!expected) return false;
  const authorization = String(request.headers.get('authorization') ?? '').trim();
  if (!authorization.toLowerCase().startsWith('bearer ')) return false;
  return safeEqual(authorization.slice(7).trim(), expected);
}

function filesFrom(form: FormData): File[] {
  return form.getAll('files').filter(
    (entry): entry is File => typeof File !== 'undefined' && entry instanceof File,
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const files = filesFrom(form);
    validatePulseFiles(files);

    const previews = await Promise.all(files.map(async (file) =>
      analyzePulseCsv(file.name, new Uint8Array(await file.arrayBuffer()))
    ));
    const kinds = new Set(previews.map((preview) => preview.kind));
    if (!kinds.has('events') || !kinds.has('workload')) {
      return NextResponse.json(
        { error: 'Arizona automation requires one Events CSV and one Workloads CSV.' },
        { status: 400 },
      );
    }

    const results = [];
    for (const file of files) {
      results.push(await importPulseFile({
        schoolCode: SCHOOL_CODE,
        organizationId: 0,
        userId: 0,
        file,
      }));
    }

    return NextResponse.json({ ok: true, schoolCode: SCHOOL_CODE, previews, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to import Arizona PULSE CSV files.';
    const status = /choose|csv|valid|recognized|limit|exceed|requires/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
