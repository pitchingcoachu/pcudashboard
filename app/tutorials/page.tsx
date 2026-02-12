import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '../../lib/auth';
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
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="portal-shell">
      <header className="portal-header">
        <div className="portal-header-left" aria-hidden="true" />
        <div className="portal-header-center">
          <nav className="portal-nav" aria-label="Portal Navigation">
            <Link href="/portal" className="portal-nav-link">
              Dashboard
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
