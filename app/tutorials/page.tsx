import Link from 'next/link';
import { requirePortalSession } from '../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../lib/dashboard-access';
import { resolveSchoolBrand, schoolBrandCssVars } from '../../lib/school-brand';
import LogoutButton from '../portal/logout-button';
import PortalUserMenu from '../portal/user-menu';
import PortalChrome from '../portal/portal-chrome';

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
  const selectedSchool = resolveDashboardSchoolCode(session);
  const brand = resolveSchoolBrand(selectedSchool);

  return (
    <PortalChrome
      schoolBrandStyle={schoolBrandCssVars(selectedSchool)}
      left={
        <>
          <Link href="/portal/dashboard" className="portal-header-logo-link" aria-label="Pearl home">
            <img src="/pearl-clam-transparent.png" alt="Pearl Player Development" className="portal-header-logo" />
          </Link>
          {brand.logoSrc ? <img src={brand.logoSrc} alt={brand.logoAlt} className="portal-header-logo portal-header-logo--school" /> : null}
        </>
      }
      navLinks={
        <>
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
        </>
      }
      mobileNavItems={[]}
      right={
        <>
          {session.role === 'admin' || session.role === 'coach' ? (
            <PortalUserMenu displayName={session.name ?? session.email} />
          ) : (
            <div className="portal-user-meta" aria-label="Logged in user">
              <p>Logged In As</p>
              <h1>{session.name ?? session.email}</h1>
            </div>
          )}
          {session.role === 'player' ? <LogoutButton /> : null}
        </>
      }
      sectionClassName="portal-panel"
    >
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
    </PortalChrome>
  );
}
