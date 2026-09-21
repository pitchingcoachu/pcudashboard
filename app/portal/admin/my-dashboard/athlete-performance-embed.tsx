'use client';

import { useState } from 'react';
import styles from './coach-dashboard.module.css';

export default function AthletePerformanceEmbed({ playerName }: { playerName: string }) {
  const [loaded, setLoaded] = useState(false);
  const source = `/portal/force-plates?embed=dashboard&player=${encodeURIComponent(playerName)}`;

  return <div className={styles.performanceEmbed}>
    {!loaded ? <div className={styles.performanceLoading}><span /> Loading {playerName}&apos;s performance workspace…</div> : null}
    <iframe
      key={playerName}
      src={source}
      title={`${playerName} biomechanics and performance data`}
      onLoad={() => setLoaded(true)}
      className={styles.performanceFrame}
    />
  </div>;
}
