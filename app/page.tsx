'use client';

import Image from 'next/image';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

type HomeSession = {
  name: string | null;
  email: string;
};

type DemoFollowupPreview = {
  subject: string;
  html: string;
  text: string;
};

function demoFollowupKicker(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('local preview')) return 'Local email preview';
  if (normalized.includes('failed') || normalized.includes('verify resend')) return 'Email preview';
  return 'Email sent to you';
}


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
    title: 'Clear data that impacts performance on the field.',
    description: 'Tools we offer to directly track and impact your players: custom tables and reports, at bat and game logs, trend charts and heatmaps, and more.',
    image: '/visual.png',
    alt: 'Data visuals in the PCU Dashboard',
  },
  {
    title: 'Organized and structured programming.',
    description: 'Create custom training plans that are easily accessible for all players. Track weight room exercises, bullpen plans, and drill packages.',
    image: '/schedule.png',
    alt: 'Schedule and programming in the PCU Dashboard',
  },
  {
    title: 'Coaches that have been there.',
    description: 'Not a software company. A team of coaches who\'ve used this data in real programs — available to help you make sense of it.',
    image: '/IMG_1982.JPG',
    alt: 'PCU coaches working with players',
  },
];


const faqItems = [
  {
    question: 'How long does it take to get our website up and running?',
    answer: 'Within 72 hours.',
  },
  {
    question: 'Do we need someone tech-savvy to run it?',
    answer: 'No. The PCU Dashboard was built by coaches for coaches — no technical background needed.',
  },
  {
    question: 'How much does it cost?',
    answer: 'Prices vary based on program size and add-on features included.',
  },
  {
    question: 'What data does it work with?',
    answer:
      'We currently integrate with Trackman, Edgertronic video, and Axioforce force plates. If your program uses other motion capture or force plate technology, we can build that integration for you as well.',
  },
  {
    question: 'Is this only pitching data?',
    answer: 'No — Trackman hitting data and catching metrics are included for every program.',
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
      'There is an optional add-on to have an analyst to help assist with programming, reports, and anything else you might need. We also offer a biomechanist consultant for those that have motion capture or force plates. We offer this for pitching and hitting. All of our coaches have professional or college coaching experience.',
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
  {
    paragraphs: [
      'The visuals are clear, specific, and immediately applicable—whether we\'re teaching movement profiles, release traits, or pitch design concepts. Instead of abstract conversations, our pitchers can see exactly what we\'re asking for, which accelerates understanding and shortens the gap between intent and execution.',
      'Just as important, it allows us to track process-driven goals and deliver consistent, objective feedback. We\'re measuring bullpen intent, execution quality, and pitch characteristics—not just results.',
    ],
    name: 'Nathan Bannister',
    school: 'University of San Diego',
    role: 'Pitching Coach',
    headshotSrc: '/banny.webp',
    headshotAlt: 'Nathan Bannister headshot',
    headshotClass: 'headshot-banny',
    logoSrc: '/San-Diego-Toreros-Logo.png',
    logoAlt: 'University of San Diego logo',
    logoClass: 'logo-san-diego',
  },
  {
    paragraphs: [
      'It has been great to work alongside Jared.',
      'It isn’t often that you find baseball tech that is built by a coach. Because of that, he has thought of almost everything that coaches need to turn data and video into actionable player development insights.',
      'One of the other things that sets Jared apart is that he works more as a partner than just someone providing a service.',
      'We are really excited about the partnership and are looking forward to using the dashboard this spring, but we are even more excited to see how he is going to continue to build and improve it in the future.',
    ],
    name: 'Mike Current',
    school: 'Creighton University',
    role: 'Assistant Coach and Recruiting Coordinator',
    headshotSrc: '/mike-current-headshot.webp',
    headshotAlt: 'Mike Current headshot',
    headshotClass: 'headshot-current',
    logoSrc: '/creighton-logo.png',
    logoAlt: 'Creighton University logo',
    logoClass: 'logo-creighton',
  },
  {
    paragraphs: [
      'The PCU Dashboard has been a total game changer for our pitching staff.',
      'Easy to navigate and grab the information and data you are looking for to assist in your player development.',
      'Always updating and adding new great features.',
    ],
    name: 'Matt Silberman',
    school: 'Dallas Baptist University',
    role: 'Pitching Coach and Recruiting Coordinator',
    headshotSrc: '/matt-silberman-headshot.webp',
    headshotAlt: 'Matt Silberman headshot',
    headshotClass: 'headshot-silberman',
    logoSrc: '/dallas-baptist.svg',
    logoAlt: 'Dallas Baptist University logo',
    logoClass: 'logo-dbu',
  },
  {
    paragraphs: [
      'The PCU Dashboard has been a huge outside help in terms of player development.',
      'Creating individual goals based on our needs and letting guys have access to their own data has kept everyone on the same page. I think this has allowed for guys to eliminate clutter in the player development aspect and focus in on 2-3 key individual areas.',
      'The other important feature that we utilize is the trending/comparing tool. It allows us to track progress as well as make adjustments easier by being able to look back at previous bullpens/Lives and see what small changes need to be made on a week to week basis.',
    ],
    name: 'Michael Lopez',
    school: 'University of New Mexico',
    role: 'Pitching Coach',
    headshotSrc: '/michael-lopez-headshot.webp',
    headshotAlt: 'Michael Lopez headshot',
    headshotClass: 'headshot-lopez',
    logoSrc: '/unm-logo.png',
    logoAlt: 'University of New Mexico logo',
    logoClass: 'logo-unm',
  },
  {
    paragraphs: [
      'The dashboard is very user-friendly and efficient, especially for those who want straightforward tools and information without digging through complicated tabs and settings.',
    ],
    name: 'David Kopp',
    school: 'University of Florida',
    role: 'Pitching Coach',
    headshotSrc: '/david-kopp-headshot.webp',
    headshotAlt: 'David Kopp headshot',
    headshotClass: 'headshot-david',
    logoSrc: '/florida-logo.png',
    logoAlt: 'University of Florida logo',
  },
];

const topTestimonials = testimonials.slice(0, 3);
const lowerTestimonials = testimonials.slice(3);

export default function Home() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isHeroMuted, setIsHeroMuted] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [contactCopied, setContactCopied] = useState(false);
  const [isSubmittingDemo, setIsSubmittingDemo] = useState(false);
  const [demoFormMessage, setDemoFormMessage] = useState<string>('');
  const [demoFollowupPreview, setDemoFollowupPreview] = useState<DemoFollowupPreview | null>(null);
  const [homeSession, setHomeSession] = useState<HomeSession | null>(null);
  const contactEmail = 'info@pitchingcoachu.com';
  const topNavRef = useRef<HTMLElement | null>(null);
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
      const target = event.target as Node;
      if (isContactOpen && contactPopoverRef.current && !contactPopoverRef.current.contains(target)) {
        setIsContactOpen(false);
      }
      if (isMobileNavOpen && topNavRef.current && !topNavRef.current.contains(target)) {
        setIsMobileNavOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isContactOpen, isMobileNavOpen, contactPopoverRef, topNavRef]);

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
    setDemoFollowupPreview(null);
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
      const data = (await response.json().catch(() => ({}))) as {
        warnings?: string[];
        error?: string;
        followupPreview?: DemoFollowupPreview | null;
      };

      if (!response.ok) {
        const errorMessage =
          typeof data.error === 'string' && data.error.length > 0
            ? data.error
            : 'Could not submit right now. Please email info@pitchingcoachu.com.';
        setDemoFormMessage(errorMessage);
        setDemoFollowupPreview(null);
        return;
      }

      form.reset();
      setDemoFollowupPreview(data.followupPreview ?? null);
      if (data.warnings && data.warnings.length > 0) {
        setDemoFormMessage(
          'Thanks. Your request was saved, but email notification failed. Please verify RESEND settings.'
        );
      } else {
        setDemoFormMessage('Thank you for your interest in the PCU Dashboard! We will contact you within 24 hours.');
      }
    } catch {
      setDemoFormMessage('Could not submit right now. Please email info@pitchingcoachu.com.');
      setDemoFollowupPreview(null);
    } finally {
      setIsSubmittingDemo(false);
    }
  };

  useEffect(() => {
    if (!demoFollowupPreview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDemoFollowupPreview(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [demoFollowupPreview]);

  const scrollToDemo = () => {
    const demoSection = document.getElementById('demo');
    if (demoSection) {
      demoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setIsMobileNavOpen(false);
    setIsContactOpen(false);
  };
  const profileLabel = homeSession?.name?.trim() || homeSession?.email || 'Profile';
  const profileInitial = profileLabel.charAt(0).toUpperCase();

  return (
    <div className={`page-shell ${isLoaded ? 'page-loaded' : ''}`}>
      <header className="top-nav" ref={topNavRef}>
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
        <button
          type="button"
          className="nav-menu-toggle"
          onClick={() => setIsMobileNavOpen((prev) => !prev)}
          aria-expanded={isMobileNavOpen}
          aria-controls="site-nav-actions"
        >
          {isMobileNavOpen ? 'Close' : 'Menu'}
        </button>
        <div
          id="site-nav-actions"
          className={`nav-actions ${isMobileNavOpen ? 'is-open' : ''}`}
        >
          <Link
            href="https://pitchingcoachu.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost as-link"
            onClick={() => setIsMobileNavOpen(false)}
          >
            PCU Website
          </Link>
          <button type="button" className="btn btn-ghost" onClick={scrollToDemo}>
            Request 7-Day Free Trial
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
            <Link href="/portal" className="profile-chip as-link" aria-label="Open dashboard" onClick={() => setIsMobileNavOpen(false)}>
              <span className="profile-avatar" aria-hidden="true">
                {profileInitial}
              </span>
              <span className="profile-meta">
                <span className="profile-name">{profileLabel}</span>
                <span className="profile-link-label">Dashboard</span>
              </span>
            </Link>
          ) : (
            <Link href="/login" className="btn btn-primary as-link" onClick={() => setIsMobileNavOpen(false)}>
              Log In
            </Link>
          )}
          <div className="nav-social-row">
            <Link
              href="https://x.com/pitchingcoachu"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="PCU on X"
              onClick={() => setIsMobileNavOpen(false)}
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
              onClick={() => setIsMobileNavOpen(false)}
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
              onClick={() => setIsMobileNavOpen(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-panel">
          <div className="hero-layout">
            <div className="hero-copy">
              <p className="hero-eyebrow">Baseball Player Development Software</p>
              <h2>Built by coaches, for coaches.</h2>
              <p className="hero-subcopy">
                The PCU Dashboard helps college baseball programs and facilities analyze and understand their pitch data — so coaches spend less time digging through information and more time developing players.
              </p>
              <div className="hero-actions">
                <button type="button" className="btn btn-primary" onClick={scrollToDemo}>
                  Request 7-Day Free Trial
                </button>
              </div>
              <p className="hero-trusted-label">Trusted by 25+ college programs and facilities</p>
            </div>
            <figure className="hero-preview">
              <video
                src="/intro.MOV"
                className="hero-preview-image"
                autoPlay
                muted={isHeroMuted}
                loop
                playsInline
                aria-label="PCU dashboard intro video"
                style={{ objectFit: 'cover', width: '100%', height: '100%' }}
              />
              <div className="hero-preview-fade" />
              <button
                type="button"
                className="hero-video-audio-toggle"
                onClick={() => setIsHeroMuted((prev) => !prev)}
                aria-label={isHeroMuted ? 'Unmute intro video' : 'Mute intro video'}
              >
                {isHeroMuted ? 'Unmute' : 'Mute'}
              </button>
            </figure>
          </div>
        </section>

        <section className="content-panel testimonials-panel reveal-section" data-reveal>
          <div className="testimonials-grid testimonials-grid--top">
            {topTestimonials.map((item, index) => (
              <article key={`${item.name}-${index}`} className="testimonial-card reveal-item" data-reveal>
                <div className="testimonial-card-top">
                  {item.headshotSrc && (
                    <Image
                      src={item.headshotSrc}
                      alt={item.headshotAlt ?? `${item.name} headshot`}
                      width={64}
                      height={64}
                      className={`testimonial-headshot ${item.headshotClass ?? ''}`}
                    />
                  )}
                  <div className="testimonial-person">
                    <p>{item.name}</p>
                    <p>{item.role}</p>
                    <p>{item.school}</p>
                  </div>
                  {item.logoSrc && (
                    <Image
                      src={item.logoSrc}
                      alt={item.logoAlt ?? `${item.school} logo`}
                      width={52}
                      height={52}
                      className={`testimonial-logo-image ${item.logoClass ?? ''}`}
                    />
                  )}
                </div>
                <div className="testimonial-quote">
                  {item.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={paragraph}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="includes" className="content-panel includes-panel reveal-section" data-reveal>
          <div className="section-head">
            <h3>What&apos;s inside</h3>
          </div>
          <div className="includes-stack">
            {dashboardIncludes.map((item, index) => (
              <article key={item.title} className={`include-row reveal-item${index % 2 === 1 ? ' include-row--reverse' : ''}`} data-reveal>
                <button className="include-row-visual" onClick={() => openLightboxBySrc(item.image!)} aria-label={`Open ${item.title}`}>
                  <Image src={item.image!} alt={item.alt} fill sizes="(max-width: 860px) 100vw, 55vw" className="include-image" />
                </button>
                <div className="include-row-text">
                  <span className="include-number">{String(index + 1).padStart(2, '0')}</span>
                  <h4>{item.title}</h4>
                  <p className="include-text">{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="content-panel cta-mid-panel reveal-section" data-reveal>
          <div className="cta-mid-inner">
            <h3>Ready to see it for yourself?</h3>
            <button type="button" className="btn btn-primary" onClick={scrollToDemo}>
              Request 7-Day Free Trial
            </button>
          </div>
        </section>

        <section className="content-panel testimonials-panel reveal-section" data-reveal>
          <div className="testimonials-grid">
            {lowerTestimonials.map((item, index) => (
              <article key={`${item.name}-${index}`} className="testimonial-card reveal-item" data-reveal>
                <div className="testimonial-card-top">
                  {item.headshotSrc && (
                    <Image
                      src={item.headshotSrc}
                      alt={item.headshotAlt ?? `${item.name} headshot`}
                      width={64}
                      height={64}
                      className={`testimonial-headshot ${item.headshotClass ?? ''}`}
                    />
                  )}
                  <div className="testimonial-person">
                    <p>{item.name}</p>
                    <p>{item.role}</p>
                    <p>{item.school}</p>
                  </div>
                  {item.logoSrc && (
                    <Image
                      src={item.logoSrc}
                      alt={item.logoAlt ?? `${item.school} logo`}
                      width={52}
                      height={52}
                      className={`testimonial-logo-image ${item.logoClass ?? ''}`}
                    />
                  )}
                </div>
                <div className="testimonial-quote">
                  {item.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={paragraph}>
                      {paragraph}
                    </p>
                  ))}
                </div>
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
            <h3>Request 7-Day Free Trial</h3>
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

      {demoFollowupPreview ? (
        <div
          className="demo-followup-modal-overlay"
          role="presentation"
          onClick={() => setDemoFollowupPreview(null)}
        >
          <section
            className="demo-followup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-followup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="demo-followup-close"
              aria-label="Close email preview"
              onClick={() => setDemoFollowupPreview(null)}
            >
              x
            </button>
            <p className="lead-followup-kicker">{demoFollowupKicker(demoFormMessage)}</p>
            <h4 id="demo-followup-title">{demoFollowupPreview.subject}</h4>
            <div
              className="lead-followup-body"
              dangerouslySetInnerHTML={{ __html: demoFollowupPreview.html }}
            />
          </section>
        </div>
      ) : null}

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
