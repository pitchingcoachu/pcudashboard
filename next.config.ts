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
  // Axioforce/ (819MB of local force-plate CSV scratch data sitting in the project
  // root, untracked and unreferenced by any code) hit the same problem a second time --
  // Next's tracer swept it into video-export's bundle specifically, pushing that one
  // function to 1.25GB uncompressed and failing the Vercel deploy outright.
  // data/pro_savant_raw/ (1.0GB, git-tracked -- MLB/MiLB Savant CSVs used only by
  // scripts/*.py offline sync tooling, never read by the live app), several loose
  // .mov demo recordings committed at the project root (not under public/, so the
  // public/**/*.mov rule above didn't catch them), and public/mediapipe/ (41MB,
  // client-only WASM/model assets the browser loads directly -- no API route ever
  // needs them server-side) were the actual remaining weight after excluding
  // Axioforce alone didn't fix the 1.25GB video-export bundle.
  outputFileTracingExcludes: {
    'app/api/**/*': [
      'public/**/*.mov',
      'public/**/*.MOV',
      'public/**/*.m4v',
      'public/**/*.mp4',
      '.motion-capture-uploads/**/*',
      'Axioforce/**/*',
      'data/pro_savant_raw/**/*',
      '*.mov',
      '*.MOV',
      'public/mediapipe/**/*',
    ],
  },
};

export default nextConfig;
