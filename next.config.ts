import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @ffmpeg-installer/ffmpeg resolves its platform binary via a dynamic
  // require() webpack can't statically analyze -- bundling it produces a
  // build error. It's used server-only (video-export route), so exclude it
  // from bundling entirely and let Node's own require() resolve it at
  // runtime instead, same as any other native/binary-bearing package.
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg'],
  // public/ video assets and the local .motion-capture-uploads/ dev storage dir (252MB,
  // untracked local file storage -- not meant for production at all) were being swept
  // into every API route's serverless function bundle by Next's default file tracing,
  // pushing at least one function (api/dashboard/biomechanics/import-status) over
  // Vercel's 250MB uncompressed limit and silently failing every production deploy.
  // API routes never need these files at build/trace time, so exclude them entirely.
  outputFileTracingExcludes: {
    'app/api/**/*': [
      'public/**/*.mov',
      'public/**/*.MOV',
      'public/**/*.m4v',
      'public/**/*.mp4',
      '.motion-capture-uploads/**/*',
    ],
  },
};

export default nextConfig;
