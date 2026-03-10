import Link from 'next/link';
import { requirePortalSession } from '../../lib/portal-session';
import LogoutButton from '../portal/logout-button';

const tutorialVideos = [
  {
    title: 'PCU Dashboard Tutorial 1',
    embedUrl: 'https://www.youtube.com/embed/I_dwmF2Kyzs',
  },
  {
    title: 'PCU Dashboard Tutorial 2',
    embedUrl: 'https://www.youtube.com/embed/mZILcjYEN8M',
  },
];

export default async function TutorialsPage() {
  const session = await requirePortalSession();

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left">
          <Link href="/portal/dashboard" className="portal-header-logo-link" aria-label="PCU Home">
            <img src="/pitching-coach-u-logo.png" alt="PCU logo" className="portal-header-logo" />
          </Link>
        </div>
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            <Link href="/portal/dashboard" className="portal-nav-link">
              PCU Dashboard
            </Link>
            {(session.role === 'admin' || session.role === 'coach') && (
              <Link href="/portal/admin" className="portal-nav-link">
                Admin
              </Link>
            )}
            <Link href="/portal/player" className="portal-nav-link">
              Player View
            </Link>
            <Link href="/tutorials" className="portal-nav-link active">
              Tutorials
            </Link>
          </nav>
        </div>
        <div className="portal-header-right">
          <div className="portal-user-meta" aria-label="Logged in user">
            <p>Logged In As</p>
            <h1>{session.name ?? session.email}</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <section className="portal-panel">
        <h2>Tutorials</h2>
        <p>Watch quick walkthroughs of key dashboard workflows.</p>
        <div className="tutorial-video-grid">
          {tutorialVideos.map((video) => (
            <article key={video.embedUrl} className="tutorial-video-card">
              <h3>{video.title}</h3>
              <div className="tutorial-video-frame-wrap">
                <iframe
                  src={video.embedUrl}
                  title={video.title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  className="tutorial-video-frame"
                />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
