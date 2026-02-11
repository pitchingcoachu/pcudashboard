'use client';

import Image from 'next/image';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

type HomeSession = {
  name: string | null;
  email: string;
};

const outcomeCards = [
  {
    title: 'Clear and Precise Data Visuals',
    description:
      'Unlimited ways to filter data to see heatmaps, movement plots, trend charts, leaderboards, custom reports, and more.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 20.5h17v-2h-17v2Zm1-4h3v-6h-3v6Zm6 0h3V3.5h-3v13Zm6 0h3V8.5h-3v8Z" />
      </svg>
    ),
  },
  {
    title: 'Custom Performance Models',
    description:
      'PCU has created several proprietary models including Stuff+, Ctrl+, QP+, and Pitching+. These provide several insights into the raw quality of a pitch, as well as the execution.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h2v14h14v2H4V4Zm3.2 9.3a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm4.8-3.8a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm4.4-2.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm1.3 8.5a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM8 14.1l3.1-2.4 1.1 1.4-3.1 2.4L8 14.1Zm5-3.7 2.8-1.7 1 1.5-2.8 1.7-1-1.5Zm.7 3.4 1.2-1.2 2.4 2.4-1.2 1.2-2.4-2.4Z" />
      </svg>
    ),
  },
  {
    title: 'Elite Level Customer Service',
    description:
      'What separates us from our competitors is not only our fast response time, but also our ability to provide meaningful insights on player performance at your discretion.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5V11H4a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 4 17h2.5v-8A5.5 5.5 0 0 1 12 3.5a5.5 5.5 0 0 1 5.5 5.5v8H12v1h6a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 18 11h-.5V9A6.5 6.5 0 0 0 12 2.5Zm-3 16a2 2 0 0 0 2 2h2.5v-1H11a1 1 0 0 1-1-1v-.5H9v.5Z" />
      </svg>
    ),
  },
];

const galleryImages = [
  { src: '/dashboard-shot-1.png', alt: 'PCU dashboard overview screen' },
  { src: '/dashboard-shot-2.png', alt: 'PCU analytics view showing pitching insights' },
  { src: '/dashboard-shot-3.png', alt: 'PCU command and development trends view' },
  { src: '/dashboard-shot-4.png', alt: 'PCU module interface for staff decision support' },
  { src: '/dashboard-shot-5.png', alt: 'PCU reporting and athlete snapshot view' },
  { src: '/dashboard-shot-6.png', alt: 'PCU dashboard screenshot 6' },
  { src: '/dashboard-shot-7.png', alt: 'PCU dashboard screenshot 7' },
  { src: '/dashboard-shot-8.png', alt: 'PCU dashboard screenshot 8' },
  { src: '/dashboard-shot-9.png', alt: 'PCU dashboard screenshot 9' },
  { src: '/dashboard-shot-10.png', alt: 'PCU dashboard screenshot 10' },
  { src: '/dashboard-shot-11.png', alt: 'PCU dashboard screenshot 11' },
  { src: '/dashboard-shot-12.png', alt: 'PCU dashboard screenshot 12' },
  { src: '/dashboard-shot-13.png', alt: 'PCU dashboard screenshot 13' },
];

const dashboardIncludes = [
  {
    title: 'Data Visuals',
    description: 'Simple to understand charts, tables, and heatmaps to monitor performance and to adjust your training.',
    image: '/dashboard-shot-3.png',
    video: '/charts-and-maps.mov',
    alt: 'Charts and heatmaps in the PCU Dashboard',
  },
  {
    title: 'Custom Tables and Reports',
    description: 'Monitor what matters to you most and build reports that you can implement with your team immediately.',
    image: '/dashboard-shot-5.png',
    video: '/custom-tables-and-reports.mov',
    alt: 'Custom tables and reports in the PCU Dashboard',
  },
  {
    title: 'Player Development Plan Builder',
    description: 'Set objective goals for each player and track progress along the way.',
    image: '/dashboard-shot-14.png',
    video: '/player-plan.mov',
    alt: 'Player Development Plan Builder view in the PCU Dashboard',
  },
  {
    title: 'Pitch Edit Feature',
    description: 'Gone are the days of mistagged pitches. Edit the pitch and pitcher to the correct specs for accurate data.',
    image: '/dashboard-shot-8.png',
    video: '/pitch-edit.mov',
    alt: 'Pitch edit feature in the PCU Dashboard',
  },
  {
    title: 'Notes and Uploads',
    description:
      'Write notes on any page and upload a photo, video, or pdf. The note will save to the page you were on and allow you to never forget a grip or cue ever again.',
    image: '/dashboard-shot-10.png',
    video: '/notes.mov',
    alt: 'Notes and uploads in the PCU Dashboard',
  },
  {
    title: 'Biomechanics',
    description: 'Upload Newtforce data into the app and monitor progress via tables and graphs.',
    image: '/dashboard-shot-11.png',
    video: '/biomechanics.mov',
    alt: 'Biomechanics workflow in the PCU Dashboard',
  },
  {
    title: 'Edgertronic Integration and Spin Visual',
    description:
      'Edgertronic video automatically syncs with each pitch and allows you to see the metrics next to it. Compare two videos side by side or view individually. Also, view the pitch as a spin visual to fully understand what the ball is doing.',
    image: '/dashboard-shot-12.png',
    video: '/edger-and-spin.mov',
    alt: 'Edgertronic integration in the PCU Dashboard',
  },
  {
    title: 'Correlation Analysis',
    description: 'Compare any two metrics to discover how strong of a correlation there is between them.',
    image: '/dashboard-shot-9.png',
    video: '/correlations-inside-pcu-dashboard.mov',
    alt: 'Correlation analysis in the PCU Dashboard',
  },
];

const whoItsFor = [
  {
    title: 'Teams',
    detail: 'Monitor performance for your entire team. Individual log ins available for players as well.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm8 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM3.5 20c0-2.8 2.6-5 5.5-5s5.5 2.2 5.5 5H3.5Zm10 0c.2-2 1.4-3.8 3.2-4.7 2.5-1.2 5.8-.2 7.3 2.2.5.8.8 1.6 1 2.5h-11.5Z" />
      </svg>
    ),
  },
  {
    title: 'Facilities',
    detail: 'Objective data for every player in your program. Individual log ins available for every client.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 21V3h18v18H3Zm2-2h3v-3H5v3Zm0-5h3v-3H5v3Zm0-5h3V5H5v4Zm5 10h4v-3h-4v3Zm0-5h4v-3h-4v3Zm0-5h4V5h-4v4Zm6 10h3V5h-3v14Z" />
      </svg>
    ),
  },
  {
    title: 'Players',
    detail: 'Looking for an edge as a player? Access objective data on your performances all season long.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.2-7 7-7s7 3.1 7 7H5Z" />
      </svg>
    ),
  },
];

const faqItems = [
  {
    question: 'How long does it take to get our website up and running?',
    answer: 'Within 72 hours.',
  },
  {
    question: "Can we view other team's data?",
    answer: 'At this time you can only see data for your own team, as well as opponents you have faced.',
  },
  {
    question: 'Is this only pitching data?',
    answer: 'No, there is hitting and catching data included as well.',
  },
  {
    question: 'Is there game video?',
    answer:
      'Currently, there is edger video (if you have it) and we will be implenting your own personal game video soon.',
  },
  {
    question: 'Can our players have access?',
    answer:
      "Yes, each player can have their own login to view their personal data. This is an optional add on at the coach's discretion.",
  },
  {
    question: 'How quickly does new data upload to website?',
    answer: 'By the end of day it is uploaded.',
  },
  {
    question: 'Do we have access to an analyst?',
    answer:
      'You will have the ability to ask questions, as well as consult about player development related things for your players.',
  },
];

const testimonials = [
  {
    paragraphs: [
      'The PCU Dashboard has been an invaluable tool for our program and pitching staff this year.',
      'The ability for myself as the pitching coach and our players to be able to see, sort, and understand actionable data in an easy to use interface has been tremendous.',
      'PCU staff continues to evolve the app constantly, making it better with new upgraded features that save time and energy for myself and allow player development to be at the foresight.',
    ],
    name: 'Nate Cole',
    school: 'Harvard University',
    role: 'Pitching Coach',
    headshotSrc: '/nate-cole-headshot.jpg',
    headshotAlt: 'Nate Cole headshot',
    headshotClass: 'headshot-nate',
    logoSrc: '/harvard-logo.png',
    logoAlt: 'Harvard logo',
    logoClass: 'logo-harvard',
  },
  {
    paragraphs: [
      'The PCU Dashboard has been a game changer for our pitching development.',
      'What stands out most is how simple and actionable everything is. There’s a lot of data in baseball right now, but PCU does an incredible job of organizing it in a way that actually helps coaches coach.',
      'The dashboard makes it easy to see what truly matters without getting lost in noise.',
    ],
    name: 'Jamie Tutko',
    school: 'Louisiana State University',
    role: 'Director of Pitching Development',
    headshotSrc: '/jamie-tutko-headshot.png',
    headshotAlt: 'Jamie Tutko headshot',
    logoSrc: '/lsu-logo.png',
    logoAlt: 'LSU logo',
    logoClass: 'logo-lsu',
  },
];

export default function Home() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [contactCopied, setContactCopied] = useState(false);
  const [isSubmittingDemo, setIsSubmittingDemo] = useState(false);
  const [demoFormMessage, setDemoFormMessage] = useState<string>('');
  const [homeSession, setHomeSession] = useState<HomeSession | null>(null);
  const contactEmail = 'info@pitchingcoachu.com';
  const contactPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoaded(true), 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/session', { credentials: 'include' });
        if (!response.ok) return;
        const data = (await response.json()) as
          | { authenticated: false }
          | { authenticated: true; name: string | null; email: string };
        if (cancelled) return;
        if (data.authenticated) {
          setHomeSession({ name: data.name, email: data.email });
        } else {
          setHomeSession(null);
        }
      } catch {
        if (!cancelled) setHomeSession(null);
      }
    };
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeIndex === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveIndex(null);
      } else if (event.key === 'ArrowRight') {
        setActiveIndex((prev) => (prev === null ? 0 : (prev + 1) % galleryImages.length));
      } else if (event.key === 'ArrowLeft') {
        setActiveIndex((prev) => (prev === null ? 0 : (prev - 1 + galleryImages.length) % galleryImages.length));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex]);

  useEffect(() => {
    const revealElements = document.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );

    revealElements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!isContactOpen || !contactPopoverRef.current) return;
      const target = event.target as Node;
      if (!contactPopoverRef.current.contains(target)) {
        setIsContactOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isContactOpen, contactPopoverRef]);

  const closeLightbox = () => setActiveIndex(null);
  const showNext = () => setActiveIndex((prev) => (prev === null ? 0 : (prev + 1) % galleryImages.length));
  const showPrevious = () =>
    setActiveIndex((prev) => (prev === null ? 0 : (prev - 1 + galleryImages.length) % galleryImages.length));
  const openLightboxBySrc = (src: string) => {
    const matchIndex = galleryImages.findIndex((item) => item.src === src);
    if (matchIndex !== -1) setActiveIndex(matchIndex);
  };
  const handleCopyContact = async () => {
    try {
      await navigator.clipboard.writeText(contactEmail);
      setContactCopied(true);
      window.setTimeout(() => setContactCopied(false), 1500);
    } catch {
      setContactCopied(false);
    }
  };
  const handleDemoSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDemoFormMessage('');
    setIsSubmittingDemo(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      school_or_facility: String(formData.get('school_or_facility') ?? ''),
      role: String(formData.get('role') ?? ''),
    };

    try {
      const response = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setDemoFormMessage('Could not submit right now. Please email info@pitchingcoachu.com.');
        return;
      }

      form.reset();
      setDemoFormMessage('Thank you for your interest in the PCU Dashboard! We will contact you within 24 hours.');
    } catch {
      setDemoFormMessage('Could not submit right now. Please email info@pitchingcoachu.com.');
    } finally {
      setIsSubmittingDemo(false);
    }
  };
  const scrollToDemo = () => {
    const demoSection = document.getElementById('demo');
    if (demoSection) {
      demoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setIsContactOpen(false);
  };
  const profileLabel = homeSession?.name?.trim() || homeSession?.email || 'Profile';
  const profileInitial = profileLabel.charAt(0).toUpperCase();

  return (
    <div className={`page-shell ${isLoaded ? 'page-loaded' : ''}`}>
      <header className="top-nav">
        <div className="brand-row">
          <Image
            src="/pitching-coach-u-logo.png"
            alt="Pitching Coach U logo"
            width={58}
            height={58}
            priority
            className="brand-logo"
          />
          <div className="brand-block">
            <h1>PCU Dashboard</h1>
          </div>
        </div>
        <div className="nav-actions">
          <Link href="https://pitchingcoachu.com" target="_blank" rel="noopener noreferrer" className="btn btn-ghost as-link">
            PCU Website
          </Link>
          <button type="button" className="btn btn-ghost" onClick={scrollToDemo}>
            Request a Demo
          </button>
          <div className="contact-popover-wrap" ref={contactPopoverRef}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsContactOpen((prev) => !prev)}>
              Contact
            </button>
            {isContactOpen && (
              <div className="contact-popover" role="dialog" aria-label="Contact options">
                <p>{contactEmail}</p>
                <div className="contact-popover-actions">
                  <Link href={`mailto:${contactEmail}`} className="btn btn-ghost as-link">
                    Send Email
                  </Link>
                  <button type="button" className="btn btn-primary" onClick={handleCopyContact}>
                    {contactCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {homeSession ? (
            <Link href="/portal" className="profile-chip as-link" aria-label="Open dashboard">
              <span className="profile-avatar" aria-hidden="true">
                {profileInitial}
              </span>
              <span className="profile-meta">
                <span className="profile-name">{profileLabel}</span>
                <span className="profile-link-label">Dashboard</span>
              </span>
            </Link>
          ) : (
            <Link href="/login" className="btn btn-primary as-link">
              Log In
            </Link>
          )}
          <Link
            href="https://x.com/pitchingcoachu"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label="PCU on X"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
            </svg>
          </Link>
          <Link
            href="https://instagram.com/pitchingcoachu"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label="PCU on Instagram"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
            </svg>
          </Link>
          <Link
            href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q"
            target="_blank"
            rel="noopener noreferrer"
            className="social-link"
            aria-label="PCU on YouTube"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
            </svg>
          </Link>
        </div>
      </header>

      <main>
        <section className="hero-panel">
          <div className="hero-layout">
            <div className="hero-copy">
              <p className="hero-eyebrow">Performance Data Built for Coaches and Players</p>
              <h2>Player Development Insights That Drive Winning.</h2>
              <p className="hero-subcopy">
                The PCU Dashboard is your one-stop shop for evaluating player performance and creating development plans that
                get results.
              </p>
              <div className="hero-actions">
                <button type="button" className="btn btn-primary" onClick={scrollToDemo}>
                  Request a Demo
                </button>
              </div>
            </div>
            <figure className="hero-preview">
              <Image
                src="/dashboard-shot-14.png"
                alt="PCU dashboard hero preview screenshot"
                fill
                priority
                sizes="(max-width: 980px) 100vw, 42vw"
                className="hero-preview-image"
              />
            </figure>
          </div>
        </section>

        <section className="content-panel reveal-section" data-reveal>
          <div className="section-head">
            <h3>Why Programs Choose PCU</h3>
          </div>
          <div className="card-grid">
            {outcomeCards.map((card) => (
              <article key={card.title} className="card reveal-item" data-reveal>
                <span className="card-icon">{card.icon}</span>
                <h4>{card.title}</h4>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="content-panel testimonials-panel reveal-section" data-reveal>
          <div className="testimonials-grid">
            {testimonials.map((item, index) => (
              <article key={`${item.name}-${index}`} className="testimonial-card reveal-item" data-reveal>
                <div className="testimonial-quote">
                  {item.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
                <div className="testimonial-meta">
                  {item.headshotSrc && (
                    <Image
                      src={item.headshotSrc}
                      alt={item.headshotAlt ?? `${item.name} headshot`}
                      width={54}
                      height={54}
                      className={`testimonial-headshot ${item.headshotClass ?? ''}`}
                    />
                  )}
                  <p>{item.name}</p>
                  <p>{item.role}</p>
                  <p>{item.school}</p>
                  {item.logoSrc && (
                    <Image
                      src={item.logoSrc}
                      alt={item.logoAlt ?? `${item.school} logo`}
                      width={48}
                      height={48}
                      className={`testimonial-logo-image ${item.logoClass ?? ''}`}
                    />
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="includes" className="content-panel includes-panel reveal-section" data-reveal>
          <div className="section-head">
            <h3>What&apos;s included in the PCU Dashboard</h3>
          </div>
          <div className="includes-grid">
            {dashboardIncludes.map((item, index) => (
              <article key={item.title} className="include-card reveal-item" data-reveal>
                <div className="include-top">
                  <span className="include-number">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h4>{item.title}</h4>
                    {item.description && <p className="include-text">{item.description}</p>}
                  </div>
                </div>
                {item.video ? (
                  <div className="include-preview">
                    <video
                      src={item.video}
                      className="include-video"
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                      aria-label={item.alt}
                    />
                  </div>
                ) : (
                  <button className="include-preview" onClick={() => openLightboxBySrc(item.image)} aria-label={`Open ${item.title}`}>
                    <Image src={item.image} alt={item.alt} fill sizes="(max-width: 980px) 100vw, 50vw" className="include-image" />
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="content-panel reveal-section" data-reveal>
          <div className="section-head">
            <h3>Who this is for</h3>
          </div>
          <div className="who-grid">
            {whoItsFor.map((item) => (
              <article key={item.title} className="who-card reveal-item" data-reveal>
                <span className="who-icon">{item.icon}</span>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="content-panel faq-panel reveal-section" data-reveal>
          <div className="section-head">
            <h3>FAQ</h3>
          </div>
          <div className="faq-list">
            {faqItems.map((item) => (
              <details key={item.question} className="faq-item reveal-item" data-reveal>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="demo" className="content-panel form-panel reveal-section" data-reveal>
          <div className="section-head">
            <h3>Request a Demo</h3>
          </div>
          <form className="lead-form" onSubmit={handleDemoSubmit}>
            <label>
              Name
              <input type="text" name="name" autoComplete="name" required />
            </label>
            <label>
              Email
              <input type="email" name="email" autoComplete="email" required />
            </label>
            <label>
              Phone
              <input type="tel" name="phone" autoComplete="tel" />
            </label>
            <label>
              School or Facility
              <input type="text" name="school_or_facility" required />
            </label>
            <label>
              Role
              <input type="text" name="role" required />
            </label>
            <button type="submit" className="btn btn-primary">
              {isSubmittingDemo ? 'Submitting...' : 'Submit Request'}
            </button>
            {demoFormMessage && <p className="lead-form-message">{demoFormMessage}</p>}
          </form>
        </section>
      </main>

      {activeIndex !== null && (
        <div className="lightbox-overlay" onClick={closeLightbox} role="dialog" aria-modal="true" aria-label="Image viewer">
          <div className="lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" onClick={closeLightbox} aria-label="Close image viewer">
              Close
            </button>
            <button className="lightbox-nav" onClick={showPrevious} aria-label="Previous image">
              Previous
            </button>
            <figure className="lightbox-figure">
              <Image
                src={galleryImages[activeIndex].src}
                alt={galleryImages[activeIndex].alt}
                width={2200}
                height={1400}
                className="lightbox-image"
              />
            </figure>
            <button className="lightbox-nav" onClick={showNext} aria-label="Next image">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
