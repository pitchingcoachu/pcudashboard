import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import styles from './college-pricing.module.css';

export const metadata: Metadata = {
  title: 'College Pricing | PCU Dashboard',
  description: 'PCU Dashboard pricing and service options for college baseball programs.',
  alternates: { canonical: '/collegepricing' },
};

const contactHref =
  'mailto:info@pitchingcoachu.com?subject=PCU%20Dashboard%20College%20Pricing';

const sharedFeatures = [
  'Player logins',
  'Edgertronic camera integration',
  'Motion capture data integration',
  'Pro data access',
];

const starterFeatures = [
  {
    title: 'Dashboard platform',
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
    title: 'Limited support',
    items: [],
  },
];

const eliteFeatures = [
  {
    title: 'Dashboard access',
    items: ['School', 'League', 'Pro'],
  },
  {
    title: 'Schedule and programming',
    items: ['Throwing', 'Lifting'],
  },
  {
    title: 'Player development consulting',
    subtitle: 'Pitching and hitting',
    items: [
      '3 Zoom calls in the fall',
      'Custom postgame reports',
      'Weekly advance report on opposing hitters',
      '3 Zoom calls in the spring',
    ],
  },
];

const addOns = [
  {
    title: 'MOCAP at your school',
    price: '$15,000',
    items: [
      'All pitchers',
      'Reports and data added to the dashboard',
      'Zoom call reviewing the analysis',
      'Assistance with programming',
    ],
  },
  {
    title: 'Biomechanics consulting',
    price: '$10,000',
    items: [
      'Work directly with biomechanist Martijn',
      'Weekly reports',
      'Data available on the dashboard',
      'Monthly player-data Zoom calls (8 total)',
      '3 recorded educational Zoom calls',
    ],
  },
  {
    title: 'Extra Zoom calls',
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
          <Link href="/" className={styles.brand} aria-label="PCU Dashboard home">
            <Image
              src="/pitching-coach-u-logo.png"
              alt="Pitching Coach U"
              width={48}
              height={48}
              priority
            />
            <span>
              <strong>PCU Dashboard</strong>
              <small>College programs</small>
            </span>
          </Link>
          <Link href="/" className={styles.backLink}>Back to website</Link>
        </header>

        <section className={styles.intro}>
          <p>College program pricing</p>
          <h1>Choose the level of support your program needs.</h1>
          <span>Two annual dashboard plans, plus optional services that can be added separately.</span>
        </section>

        <section className={styles.shared} aria-labelledby="shared-title">
          <div className={styles.sharedHeading}>
            <span>Included with Starter and Elite</span>
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
                <h2>Starter</h2>
              </div>
              <div className={styles.price}>$7,500<small>/ year</small></div>
            </div>
            <p className={styles.planDescription}>
              Full dashboard access for programs that want the data platform and essential support.
            </p>
            <div className={styles.featureGroups}>
              {starterFeatures.map((group) => (
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
            <a href={contactHref} className={styles.secondaryButton}>Ask about Starter</a>
          </article>

          <article className={`${styles.planCard} ${styles.featuredCard}`}>
            <span className={styles.recommended}>Most comprehensive</span>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.planLabel}>Dashboard + consulting</span>
                <h2>Elite</h2>
              </div>
              <div className={styles.price}>$12,000<small>/ year</small></div>
            </div>
            <p className={styles.planDescription}>
              Dashboard access plus programming and ongoing pitching and hitting development support.
            </p>
            <div className={styles.featureGroups}>
              {eliteFeatures.map((group) => (
                <div className={styles.featureGroup} key={group.title}>
                  <h3>{group.title}</h3>
                  {'subtitle' in group && group.subtitle ? <p>{group.subtitle}</p> : null}
                  <ul>
                    {group.items.map((item) => <li key={item}><CheckIcon />{item}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <a href={contactHref} className={styles.primaryButton}>Ask about Elite</a>
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
                    <h3>{addOn.title}</h3>
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
            <a href={contactHref} className={styles.secondaryButton}>Ask about add-ons</a>
          </article>
        </section>

        <section className={styles.contact}>
          <div>
            <span>Questions about fit?</span>
            <h2>We’ll help you choose the right setup.</h2>
          </div>
          <a href={contactHref}>Email PCU</a>
        </section>

        <footer className={styles.footer}>
          <span>PCU Dashboard</span>
          <a href="mailto:info@pitchingcoachu.com">info@pitchingcoachu.com</a>
        </footer>
      </div>
    </main>
  );
}
