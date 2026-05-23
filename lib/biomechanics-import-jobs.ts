import { saveSinglePitchPoints } from './biomechanics-db';

export type SinglePitchImportFile = {
  sourceFileName: string;
  csvContent: string;
  rows: Array<Record<string, unknown>>;
};

export type BiomechanicsImportJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type BiomechanicsImportJob = {
  id: string;
  organizationId: number;
  schoolCode: string;
  pitcherName: string;
  createdByUserId: number | null;
  files: SinglePitchImportFile[];
  status: BiomechanicsImportJobStatus;
  totalRows: number;
  processedRows: number;
  filesProcessed: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

declare global {
  var __pcuBiomechJobs: Map<string, BiomechanicsImportJob> | undefined;
  var __pcuBiomechJobsRunning: Set<string> | undefined;
}

function jobsMap(): Map<string, BiomechanicsImportJob> {
  if (!global.__pcuBiomechJobs) global.__pcuBiomechJobs = new Map();
  return global.__pcuBiomechJobs;
}

function runningSet(): Set<string> {
  if (!global.__pcuBiomechJobsRunning) global.__pcuBiomechJobsRunning = new Set();
  return global.__pcuBiomechJobsRunning;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createSinglePitchImportJob(input: {
  organizationId: number;
  schoolCode: string;
  pitcherName: string;
  createdByUserId: number | null;
  files: SinglePitchImportFile[];
}): BiomechanicsImportJob {
  const id = `biojob_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const totalRows = input.files.reduce((sum, file) => sum + file.rows.length, 0);
  const job: BiomechanicsImportJob = {
    id,
    organizationId: input.organizationId,
    schoolCode: input.schoolCode,
    pitcherName: input.pitcherName,
    createdByUserId: input.createdByUserId,
    files: input.files,
    status: 'queued',
    totalRows,
    processedRows: 0,
    filesProcessed: 0,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  jobsMap().set(id, job);
  return job;
}

export function getImportJob(jobId: string): BiomechanicsImportJob | null {
  return jobsMap().get(String(jobId ?? '').trim()) ?? null;
}

export async function runSinglePitchImportJob(jobId: string): Promise<void> {
  const id = String(jobId ?? '').trim();
  if (!id) return;
  const jobs = jobsMap();
  const running = runningSet();
  const job = jobs.get(id);
  if (!job) return;
  if (running.has(id)) return;
  running.add(id);
  try {
    job.status = 'running';
    job.updatedAt = nowIso();
    for (const file of job.files) {
      await saveSinglePitchPoints({
        organizationId: job.organizationId,
        schoolCode: job.schoolCode,
        sourceFileName: file.sourceFileName,
        csvContent: file.csvContent,
        rows: file.rows,
        createdByUserId: job.createdByUserId,
        pitcherName: job.pitcherName,
        onChunkCommitted: (committed) => {
          job.processedRows = Math.min(job.totalRows, job.processedRows + committed);
          job.updatedAt = nowIso();
        },
      });
      job.filesProcessed += 1;
      job.updatedAt = nowIso();
    }
    job.status = 'completed';
    job.processedRows = job.totalRows;
    job.updatedAt = nowIso();
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Import failed.';
    job.updatedAt = nowIso();
  } finally {
    running.delete(id);
  }
}

