import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { deleteObjectFromR2, getR2Bucket, getR2Client } from './biomechanics-storage';
import { getAiSessionForOrganization, syncAiSessionPlayerNotes, updateAiSessionResult } from './ai-workspace-db';
import { summarizeTranscript, transcribeAudioFiles } from './ai-generation';

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => { error = `${error}${chunk}`.slice(-4000); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(error || `Audio extraction failed (${code}).`)));
  });
}

export async function processAiSession(sessionId: number, organizationId: number): Promise<void> {
  const session = await getAiSessionForOrganization(sessionId, organizationId);
  if (!session || !session.sourceR2Key) throw new Error('Recording was not found.');
  const client = getR2Client();
  if (!client) throw new Error('Recording storage is not configured.');
  const dir = await mkdtemp(path.join(tmpdir(), `pearl-ai-${sessionId}-`));
  const inputPath = path.join(dir, `source-${session.sourceFileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`);
  try {
    await updateAiSessionResult({ id: sessionId, organizationId, status: 'processing', sourceR2Key: session.sourceR2Key, error: null });
    const object = await client.send(new GetObjectCommand({ Bucket: getR2Bucket(), Key: session.sourceR2Key }));
    if (!object.Body) throw new Error('Recording is empty.');
    await pipeline(object.Body as NodeJS.ReadableStream, createWriteStream(inputPath));
    const audioPath = path.join(dir, 'audio.m4a');
    await runFfmpeg(['-y','-i',inputPath,'-vn','-ac','1','-ar','16000','-b:a','48k',audioPath]);
    await runFfmpeg(['-y','-i',audioPath,'-f','segment','-segment_time','1200','-c','copy',path.join(dir,'chunk-%03d.m4a')]);
    const chunkPaths = (await readdir(dir)).filter((name)=>name.startsWith('chunk-')&&name.endsWith('.m4a')).sort().map((name)=>path.join(dir,name));
    const transcript = await transcribeAudioFiles(chunkPaths.length ? chunkPaths : [audioPath]);
    const bullets = await summarizeTranscript({ transcript, sessionType: session.sessionType, title: session.title, playerNames: session.playerNames });
    const audioKey = `ai-sessions/org-${organizationId}/session-${sessionId}/audio.m4a`;
    await client.send(new PutObjectCommand({ Bucket:getR2Bucket(),Key:audioKey,Body:await readFile(audioPath),ContentType:'audio/mp4' }));
    await deleteObjectFromR2(session.sourceR2Key);
    await updateAiSessionResult({ id:sessionId,organizationId,status:'ready',transcript,bullets,audioR2Key:audioKey,audioContentType:'audio/mp4',sourceR2Key:null,error:null });
    await syncAiSessionPlayerNotes(sessionId, organizationId);
  } catch (error) {
    await updateAiSessionResult({ id:sessionId,organizationId,status:'failed',sourceR2Key:session.sourceR2Key,error:error instanceof Error?error.message:'Processing failed.' }).catch(()=>{});
    throw error;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
