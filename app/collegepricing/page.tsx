import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import styles from './college-pricing.module.css';
import pearlLockup from '../../pearl/pearl-lockup-transparent.png';

export const metadata: Metadata = {
  title: 'College Pricing | Pearl Player Development',
  description: 'Pearl Player Development pricing and service options for college baseball programs.',
  alternates: { canonical: '/collegepricing' },
};

const contactHref =
  'mailto:info@pitchingcoachu.com?subject=Pearl%20Player%20Development%20College%20Pricing';

const sharedFeatures = [
  'Player logins',
  'Edgertronic camera integration',
  'Motion capture data integration',
  'Pro data access',
];

const platformFeatures = [
  {
    title: 'Dashboard Platform',
    items: [
      'Comprehensive ball flight and batted ball data',
      'Custom table and report builder',
      'Leaderboards and trend charts',
      'Player plan goal center',
      'Player notes and performance tracking',
      'Access to MLB and AAA data',
    ],
  },
  {
    title: 'Limited Support',
    items: [],
  },
];

const platformDevelopmentFeatures = [
  {
    title: 'Dashboard Platform',
    items: [
      'Comprehensive ball flight and batted ball data',
      'Custom table and report builder',
      'Leaderboards and trend charts',
      'Player plan goal center',
      'Player notes and performance tracking',
      'Access to MLB and AAA data',
    ],
  },
  {
    title: 'Program and Schedule Builder',
    items: [
      'Throwing calendar',
      'Workout builder and tracker',
      'Custom bullpen and drill scripts',
    ],
  },
  {
    title: 'Player Development Consulting',
    subtitle: 'Pitching and hitting',
    items: [
      'x5, 1-hour zoom calls',
      'Done-for-you postgame reports',
      'Weekly advance reports on opposing pitchers and hitters',
    ],
  },
];

const addOns = [
  {
    title: 'On Campus MOCAP Analysis',
    price: '$15,000',
    items: [
      'All pitchers',
      'Reports and data added to the dashboard',
      'Zoom call reviewing the analysis',
      'Assistance with programming',
    ],
  },
  {
    title: 'Program and Schedule Builder',
    subtitle: 'Only necessary for teams on the Platform plan',
    price: '$3,000',
    items: [
      'Throwing calendar',
      'Workout builder and tracker',
      'Custom bullpen and drill scripts',
    ],
  },
  {
    title: 'Extra Zoom Calls',
    price: '$300',
    suffix: '/ hour',
    items: [],
  },
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4 10.5 3.5 3.5L16 6" />
    </svg>
  );
}

export default function CollegePricingPage() {
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
            <small className={styles.brandAudience}>College programs</small>
          </Link>
          <div className={styles.headerActions}>
            <nav className={styles.socialNav} aria-label="Pearl social media">
              <Link
                href="https://x.com/pitchingcoachu"
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
          <p>College program pricing</p>
          <h1>Choose the level of support your program needs.</h1>
          <span>Two annual dashboard plans, plus optional services that can be added separately.</span>
        </section>

        <section className={styles.shared} aria-labelledby="shared-title">
          <div className={styles.sharedHeading}>
            <span>Included with both plans</span>
            <h2 id="shared-title">Every dashboard plan includes</h2>
          </div>
          <ul>
            {sharedFeatures.map((feature) => (
              <li key={feature}><CheckIcon />{feature}</li>
            ))}
          </ul>
        </section>

        <section className={styles.pricingGrid} aria-label="College pricing options">
          <article className={styles.planCard}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Dashboard plan</span>
                <h2>Platform</h2>
              </div>
              <div className={styles.price}>$7,500<small>/ year</small></div>
            </div>
            <p className={styles.planDescription}>
              Full dashboard access for programs that want the data platform and essential support.
            </p>
            <div className={styles.featureGroups}>
              {platformFeatures.map((group) => (
                <div className={styles.featureGroup} key={group.title}>
                  <h3>{group.title}</h3>
                  {group.items.length > 0 ? (
                    <ul>
                      {group.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.buttonSlot}>
              <a href={contactHref} className={styles.secondaryButton}>Ask about Platform</a>
            </div>
          </article>

          <article className={`${styles.planCard} ${styles.featuredCard}`}>
            <span className={styles.recommended}>Most comprehensive</span>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Dashboard + consulting</span>
                <h2>Platform + Development</h2>
              </div>
              <div className={styles.price}>$12,000<small>/ year</small></div>
            </div>
            <p className={styles.planDescription}>
              Dashboard access plus programming and ongoing pitching and hitting development support.
            </p>
            <div className={styles.featureGroups}>
              {platformDevelopmentFeatures.map((group) => (
                <div className={styles.featureGroup} key={group.title}>
                  <h3>{group.title}</h3>
                  {'subtitle' in group && group.subtitle ? <p>{group.subtitle}</p> : null}
                  <ul>
                    {group.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <div className={styles.buttonSlot}>
              <a href={contactHref} className={styles.primaryButton}>Ask about Platform + Development</a>
            </div>
          </article>

          <article className={`${styles.planCard} ${styles.addOnCard}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Optional services</span>
                <h2>À La Carte</h2>
              </div>
            </div>
            <p className={styles.planDescription}>
              Add specialized data collection, analysis, or consulting based on your program’s needs.
            </p>
            <div className={styles.addOnList}>
              {addOns.map((addOn) => (
                <section className={styles.addOn} key={addOn.title}>
                  <div className={styles.addOnHeading}>
                    <div>
                      <h3>{addOn.title}</h3>
                      {'subtitle' in addOn && addOn.subtitle ? <p>{addOn.subtitle}</p> : null}
                    </div>
                    <strong>{addOn.price}<small>{addOn.suffix}</small></strong>
                  </div>
                  {addOn.items.length > 0 ? (
                    <ul>
                      {addOn.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
            <div className={styles.buttonSlot}>
              <a href={contactHref} className={styles.secondaryButton}>Ask about add-ons</a>
            </div>
          </article>
        </section>

        <section className={styles.contact}>
          <div>
            <span>Questions about fit?</span>
            <h2>We’ll help you choose the right setup.</h2>
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
