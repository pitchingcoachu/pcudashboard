import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import styles from './home-navigation.module.css';

export type HomeNavigationItem = {
  href: string;
  label: string;
  description?: string;
};

export type HomeNavigationModule = {
  key: 'coach-dashboard' | 'ball-flight' | 'performance' | 'programming' | 'roster' | 'booking' | 'scorebook' | 'nutrition' | 'more';
  title: string;
  description: string;
  href: string;
  items: HomeNavigationItem[];
  meta?: string;
};

function ModuleIcon({ name }: { name: HomeNavigationModule['key'] }) {
  if (name === 'coach-dashboard') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 15.5 16 5l12 10.5"/><path d="M7.5 13.5V27h17V13.5"/><path d="M13 27v-8.5h6V27"/></svg>;
  if (name === 'ball-flight') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4.5 17C7 8.8 11 5 16 5s9 3.8 11.5 12M4.5 17 16 27.5 27.5 17"/><path d="m16 27.5-6.7-7.2L16 13l6.7 7.3-6.7 7.2Z"/><circle cx="16" cy="20.3" r="1.5"/></svg>;
  if (name === 'performance') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 25V15m7 10V9m7 16V13m7 12V5"/><path d="M4 25h24"/></svg>;
  if (name === 'programming') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="7" width="22" height="20" rx="3"/><path d="M10 4v6m12-6v6M5 13h22M10 18h4m4 0h4m-12 5h4"/></svg>;
  if (name === 'roster') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="11" r="4"/><path d="M4 26c.7-6 3.3-9 8-9s7.3 3 8 9M21 10h7m-3.5-3.5v7"/></svg>;
  if (name === 'booking') return <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="7" width="22" height="20" rx="3"/><path d="M10 4v6m12-6v6M5 13h22m-15 6 3 3 7-7"/></svg>;
  if (name === 'scorebook') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 6h9a5 5 0 0 1 5 5v16h-9a5 5 0 0 0-5 2V6Z"/><path d="M27 6h-5a5 5 0 0 0-3 1v20h3a5 5 0 0 1 5 2V6Z"/><path d="M9 12h5m-5 5h5"/></svg>;
  if (name === 'nutrition') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 9c-2-4-6-5-9-2-4 4-1 17 5 20 2 1 3-1 4-1s2 2 4 1c6-3 9-16 5-20-3-3-7-2-9 2Z"/><path d="M16 9c0-4 2-6 6-7m-6 7c-2-2-4-3-7-3"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 8h22M5 16h22M5 24h22"/><circle cx="11" cy="8" r="2.5"/><circle cx="21" cy="16" r="2.5"/><circle cx="14" cy="24" r="2.5"/></svg>;
}

export default function HomeNavigation({ modules, adminToolsContent, firstName }: { modules: HomeNavigationModule[]; adminToolsContent?: ReactNode; firstName: string }) {
  return (
    <section className={styles.section} aria-labelledby="workspace-heading">
      <header className={styles.heading}>
        <div>
          <p>PEARL COMMAND CENTER</p>
          <h1 id="workspace-heading">Welcome Back, {firstName}</h1>
          <span>Everything is organized by workflow, with the detailed tools one click away.</span>
        </div>
        <div className={styles.status}><i /> Workspace ready</div>
      </header>

      <div className={styles.grid}>
        {modules.map((module, index) => (
          <article key={module.key} className={`${styles.card} ${styles[module.key]}`} style={{ '--module-index': index } as CSSProperties}>
            <Link href={module.href} className={styles.primaryLink} aria-label={`Open ${module.title}`}>
              <div className={styles.cardTop}>
                <div className={styles.icon}><ModuleIcon name={module.key} /></div>
                <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
              </div>
              <div className={styles.cardCopy}>
                <h2>{module.title}</h2>
                <span>{module.description}</span>
              </div>
              <div className={styles.cardFooter}>
                <small>{module.meta ?? `${module.items.length} ${module.items.length === 1 ? 'destination' : 'destinations'}`}</small>
                <b>Open <span aria-hidden="true">↗</span></b>
              </div>
            </Link>

            {module.items.length ? (
              <details className={styles.menu}>
                <summary>
                  <span>Choose a page</span>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5"/></svg>
                </summary>
                <div className={`${styles.menuList}${module.key === 'more' ? ` ${styles.adminToolsMenu}` : ''}`}>
                  {module.items.map((item) => (
                    <Link href={item.href} key={`${module.key}-${item.href}-${item.label}`}>
                      <span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
                      <b aria-hidden="true">→</b>
                    </Link>
                  ))}
                  {module.key === 'more' && adminToolsContent ? <div className={styles.adminToolsContent}>{adminToolsContent}</div> : null}
                </div>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
