'use client';

// Web port of pearl-player-development's avatar treatment: a photo when one
// resolves (group's own uploaded photo, or the other participant's player
// profile photo for a 1:1), otherwise initials on the site's champagne
// accent color -- one consistent color, not a per-name hash.
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function MessagesAvatar({
  label,
  size = 44,
  photoUrl,
}: {
  label: string;
  size?: number;
  photoUrl?: string | null;
}) {
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- data URLs (player
    // photos / group photos) aren't compatible with next/image's optimizer.
    return <img src={photoUrl} alt="" style={style} className="portal-messages-avatar-image" />;
  }
  return (
    <div style={style} className="portal-messages-avatar-fallback">
      <span style={{ fontSize: size * 0.36 }}>{initialsFor(label)}</span>
    </div>
  );
}
