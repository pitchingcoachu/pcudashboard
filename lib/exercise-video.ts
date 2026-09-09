export type ExerciseVideoProvider =
  | 'youtube'
  | 'vimeo'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'loom'
  | 'direct'
  | 'website';

export type ExerciseVideoSource = {
  originalUrl: string;
  provider: ExerciseVideoProvider;
  providerLabel: string;
  playback: 'iframe' | 'video' | 'external';
  playbackUrl: string | null;
  layout: 'landscape' | 'portrait' | 'social';
};

export function shouldResolveExerciseVideoUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (['vm.tiktok.com', 'vt.tiktok.com', 'fb.watch', 't.co'].includes(hostname)) return true;
    if (isHost(hostname, 'tiktok.com') && parsed.pathname.toLowerCase().startsWith('/t/')) return true;
    if (isHost(hostname, 'instagram.com') && parsed.pathname.toLowerCase().startsWith('/share/')) return true;
    return false;
  } catch {
    return false;
  }
}

function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function firstPathValue(pathname: string, markers: string[]): string {
  const parts = pathname.split('/').filter(Boolean);
  const markerIndex = parts.findIndex((part) => markers.includes(part.toLowerCase()));
  return markerIndex >= 0 ? (parts[markerIndex + 1] ?? '') : '';
}

function cleanId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-].*$/, '');
}

function source(
  originalUrl: string,
  provider: ExerciseVideoProvider,
  providerLabel: string,
  playback: ExerciseVideoSource['playback'],
  playbackUrl: string | null,
  layout: ExerciseVideoSource['layout'] = 'landscape'
): ExerciseVideoSource {
  return { originalUrl, provider, providerLabel, playback, playbackUrl, layout };
}

export function resolveExerciseVideoUrl(raw: string): ExerciseVideoSource {
  const originalUrl = raw.trim();
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return source(originalUrl, 'website', 'Source', 'external', null);
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (isHost(hostname, 'youtu.be')) {
      const id = cleanId(pathParts[0] ?? '');
      return source(originalUrl, 'youtube', 'YouTube', id ? 'iframe' : 'external', id ? `https://www.youtube-nocookie.com/embed/${id}` : null);
    }
    if (isHost(hostname, 'youtube.com') || isHost(hostname, 'youtube-nocookie.com')) {
      const id = cleanId(
        parsed.searchParams.get('v')
          ?? firstPathValue(parsed.pathname, ['shorts', 'embed', 'live'])
      );
      return source(originalUrl, 'youtube', 'YouTube', id ? 'iframe' : 'external', id ? `https://www.youtube-nocookie.com/embed/${id}` : null);
    }

    if (isHost(hostname, 'vimeo.com')) {
      const id = pathParts.find((part) => /^\d+$/.test(part)) ?? '';
      return source(originalUrl, 'vimeo', 'Vimeo', id ? 'iframe' : 'external', id ? `https://player.vimeo.com/video/${id}` : null);
    }

    if (isHost(hostname, 'tiktok.com')) {
      const id = firstPathValue(parsed.pathname, ['video', 'v1', 'v']);
      return source(
        originalUrl,
        'tiktok',
        'TikTok',
        /^\d+$/.test(id) ? 'iframe' : 'external',
        /^\d+$/.test(id) ? `https://www.tiktok.com/player/v1/${id}?controls=1&description=1` : null,
        'portrait'
      );
    }

    if (isHost(hostname, 'instagram.com')) {
      const kind = (pathParts[0] ?? '').toLowerCase();
      const shortcode = cleanId(pathParts[1] ?? '');
      const normalizedKind = kind === 'reels' ? 'reel' : kind;
      const canEmbed = ['reel', 'p', 'tv'].includes(normalizedKind) && Boolean(shortcode);
      return source(
        originalUrl,
        'instagram',
        'Instagram',
        canEmbed ? 'iframe' : 'external',
        canEmbed ? `https://www.instagram.com/${normalizedKind}/${shortcode}/embed/` : null,
        'portrait'
      );
    }

    if (isHost(hostname, 'facebook.com') || isHost(hostname, 'fb.watch')) {
      const canEmbed = hostname === 'fb.watch'
        || parsed.pathname.toLowerCase().includes('/reel/')
        || parsed.pathname.toLowerCase().includes('/videos/')
        || parsed.pathname.toLowerCase().includes('/watch')
        || parsed.searchParams.has('v');
      return source(
        originalUrl,
        'facebook',
        'Facebook',
        canEmbed ? 'iframe' : 'external',
        canEmbed ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(originalUrl)}&show_text=false&width=720` : null,
        'social'
      );
    }

    if (isHost(hostname, 'x.com') || isHost(hostname, 'twitter.com')) {
      const id = firstPathValue(parsed.pathname, ['status', 'statuses']);
      return source(
        originalUrl,
        'x',
        'X',
        /^\d+$/.test(id) ? 'iframe' : 'external',
        /^\d+$/.test(id) ? `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true` : null,
        'social'
      );
    }

    if (isHost(hostname, 'loom.com')) {
      const id = cleanId(firstPathValue(parsed.pathname, ['share', 'embed']));
      return source(originalUrl, 'loom', 'Loom', id ? 'iframe' : 'external', id ? `https://www.loom.com/embed/${id}` : null);
    }

    if (/\.(mp4|m4v|mov|webm|ogv|ogg)(?:$|[?#])/i.test(originalUrl)) {
      return source(originalUrl, 'direct', 'Video file', 'video', originalUrl);
    }

    return source(originalUrl, 'website', parsed.hostname, 'external', null);
  } catch {
    return source(originalUrl, 'website', 'Source', 'external', null);
  }
}
