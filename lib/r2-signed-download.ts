import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Bucket, getR2Client } from './biomechanics-storage';

const DEFAULT_EXPIRY_SECONDS = 15 * 60;

export async function createSignedR2DownloadUrl(input: {
  key: string;
  contentType?: string | null;
  contentDisposition?: string | null;
  expiresIn?: number;
}): Promise<string | null> {
  if (!input.key || input.key.startsWith('local:')) return null;
  const client = getR2Client();
  if (!client) return null;

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getR2Bucket(),
      Key: input.key,
      ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
      ...(input.contentDisposition ? { ResponseContentDisposition: input.contentDisposition } : {}),
      ResponseCacheControl: 'private, max-age=300',
    }),
    { expiresIn: Math.max(60, Math.min(60 * 60, input.expiresIn ?? DEFAULT_EXPIRY_SECONDS)) }
  );
}

export function signedR2Redirect(url: string): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: url,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
