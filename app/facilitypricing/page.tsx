import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import styles from '../collegepricing/college-pricing.module.css';
import pearlLockup from '../../pearl/pearl-lockup-transparent.png';

export const metadata: Metadata = {
  title: 'Facility Pricing | Pearl Player Development',
  description: 'Pearl Player Development pricing and service options for baseball training facilities.',
  alternates: { canonical: '/facilitypricing' },
};

const contactHref =
  'mailto:info@pitchingcoachu.com?subject=Pearl%20Player%20Development%20Facility%20Pricing';

type FeatureGroup = {
  title: string;
  items: string[];
  summary?: string;
};

const prices = {
  annual: {
    programming: '$3,000',
    dataOnly: '$5,000',
    data: '$7,500',
    suffix: '/ year',
  },
  monthly: {
    programming: '$400',
    dataOnly: '$600',
    data: '$800',
    suffix: '/ month',
  },
};

const programmingFeatures: FeatureGroup[] = [
  {
    title: 'Program and Schedule Builder',
    items: [
      'Unlimited players',
      'Throwing calendar',
      'Workout builder and tracker',
      'Custom bullpen and drill scripts',
      'Scheduled player questionnaires',
      'Player goal setting and tracker',
      'Weight log tracker',
      'Player Notes',
      'Upload videos, photos, PDF\'s',
      'Video breakdown editor',
    ],
  },
];

const dashboardPlatformFeatures: FeatureGroup[] = [
  {
    title: 'Dashboard Platform',
    items: [
      'Comprehensive ball flight and batted ball data',
      'Custom table and report builder',
      'Leaderboards and trend charts',
      'Player plan goal center',
      'Player notes and performance tracking',
      'Access to MLB and AAA data',
      'Edgertronic camera integration',
      'MOCAP and force plate integration',
    ],
  },
];

const programmingDataFeatures: FeatureGroup[] = [
  ...dashboardPlatformFeatures,
  {
    title: 'Program and Schedule Builder',
    items: [],
    summary: 'Includes every Programming Platform feature, including unlimited players.',
  },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10.5 3.5 3.5L16 6" />
    </svg>
  );
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FacilityPricingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const billing = params.billing === 'monthly' ? 'monthly' : 'annual';
  const selectedPrices = prices[billing];

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand} aria-label="Pearl Player Development home">
            <span className={styles.brandLogoFrame}>
              <Image
                src={pearlLockup}
                alt="Pearl Player Development"
                fill
                sizes="(max-width: 700px) 180px, 250px"
                priority
                className={styles.brandLogo}
              />
            </span>
            <small className={styles.brandAudience}>Training facilities</small>
          </Link>
          <div className={styles.headerActions}>
            <nav className={styles.socialNav} aria-label="Pearl social media">
              <Link
                href="https://x.com/pearlplayerdev"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pearl on X"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2H21l-6.528 7.462L22.148 22h-6.012l-4.708-6.163L6.035 22H3.277l6.983-7.979L2 2h6.166l4.255 5.617L18.244 2Zm-2.108 18h1.58L7.308 3.896H5.612L16.136 20Z" />
                </svg>
              </Link>
              <Link
                href="https://instagram.com/pitchingcoachu"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pearl on Instagram"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.75A4 4 0 0 0 3.75 7.75v8.5a4 4 0 0 0 4 4h8.5a4 4 0 0 0 4-4v-8.5a4 4 0 0 0-4-4h-8.5Zm9.063 1.312a1.188 1.188 0 1 1 0 2.375 1.188 1.188 0 0 1 0-2.375ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 1.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z" />
                </svg>
              </Link>
              <Link
                href="https://youtube.com/@pitchingcoachu?si=rstmKgKPdnzbLv6q"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pearl on YouTube"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M23 12s0-3.2-.4-4.6a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.5.3a3 3 0 0 0-2.1 2.1C1 8.8 1 12 1 12s0 3.2.4 4.6a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.5-.3a3 3 0 0 0 2.1-2.1C23 15.2 23 12 23 12ZM10 15.5v-7l6 3.5-6 3.5Z" />
                </svg>
              </Link>
            </nav>
            <Link href="/" className={styles.backLink}>Back to website</Link>
          </div>
        </header>

        <section className={styles.intro}>
          <p>Facility pricing</p>
          <h1>Choose the level of support your facility needs.</h1>
          <span>Three platform options for facilities that need programming delivery, data tools, or both.</span>
          <div className={styles.billingToggle} aria-label="Billing frequency">
            <Link
              href="/facilitypricing"
              className={billing === 'annual' ? styles.billingToggleActive : undefined}
              aria-current={billing === 'annual' ? 'page' : undefined}
            >
              Annual
            </Link>
            <Link
              href="/facilitypricing?billing=monthly"
              className={billing === 'monthly' ? styles.billingToggleActive : undefined}
              aria-current={billing === 'monthly' ? 'page' : undefined}
            >
              Monthly
            </Link>
          </div>
        </section>

        <section className={styles.pricingGrid} aria-label="Facility pricing options">
          <article className={styles.planCard}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Programming plan</span>
                <h2>Programming Platform</h2>
              </div>
              <div className={styles.price}>{selectedPrices.programming}<small>{selectedPrices.suffix}</small></div>
            </div>
            <p className={styles.planDescription}>
              Programming tools for facilities that need scheduling, workouts, and throwing-plan delivery.
            </p>
            <div className={styles.featureGroups}>
              {programmingFeatures.map((group) => (
                <div className={styles.featureGroup} key={group.title}>
                  <h3>{group.title}</h3>
                  {group.summary ? <p>{group.summary}</p> : null}
                  {group.items.length > 0 ? (
                    <ul>
                      {group.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.buttonSlot}>
              <a href={contactHref} className={styles.secondaryButton}>Ask about Programming Platform</a>
            </div>
          </article>

          <article className={styles.planCard}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Data plan</span>
                <h2>Data Platform</h2>
              </div>
              <div className={styles.price}>{selectedPrices.dataOnly}<small>{selectedPrices.suffix}</small></div>
            </div>
            <p className={styles.planDescription}>
              Dashboard data platform access for facilities focused on performance analysis and reporting.
            </p>
            <div className={styles.featureGroups}>
              {dashboardPlatformFeatures.map((group) => (
                <div className={styles.featureGroup} key={group.title}>
                  <h3>{group.title}</h3>
                  {group.summary ? <p>{group.summary}</p> : null}
                  {group.items.length > 0 ? (
                    <ul>
                      {group.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.buttonSlot}>
              <a href={contactHref} className={styles.secondaryButton}>Ask about Data Platform</a>
            </div>
          </article>

          <article className={`${styles.planCard} ${styles.featuredCard}`}>
            <span className={styles.recommended}>Most comprehensive</span>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Programming + data</span>
                <h2>Combined Package</h2>
              </div>
              <div className={styles.price}>{selectedPrices.data}<small>{selectedPrices.suffix}</small></div>
            </div>
            <p className={styles.planDescription}>
              Programming tools plus dashboard data platform access for facilities that want both training delivery and performance analysis.
            </p>
            <div className={styles.featureGroups}>
              {programmingDataFeatures.map((group) => (
                <div className={styles.featureGroup} key={group.title}>
                  <h3>{group.title}</h3>
                  {group.summary ? <p>{group.summary}</p> : null}
                  {group.items.length > 0 ? (
                    <ul>
                      {group.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.buttonSlot}>
              <a href={contactHref} className={styles.primaryButton}>Ask about Combined Package</a>
            </div>
          </article>
        </section>

        <section className={styles.contact}>
          <div>
            <span>Questions about fit?</span>
            <h2>We&apos;ll help you choose the right setup.</h2>
          </div>
          <a href={contactHref}>Email Pearl</a>
        </section>

        <footer className={styles.footer}>
          <span>Pearl Player Development</span>
          <a href="mailto:info@pitchingcoachu.com">info@pitchingcoachu.com</a>
        </footer>
      </div>
    </main>
  );
}
