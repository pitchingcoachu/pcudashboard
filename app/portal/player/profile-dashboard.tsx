'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { AssessmentWorkoutScoreRow, BodyWeightLogRow, ProgramItemRow } from '../../../lib/training-db';
import WorkoutLogModal from '../components/workout-log-modal';

type TrackedExercise = {
  exerciseId: number;
  name: string;
  category: string;
};

type ExerciseTrendPoint = {
  dayDate: string;
  averageLoad: number;
};

type ProfileDashboardProps = {
  playerId: number;
  isAdminPreview: boolean;
  fullProgramHref: string;
  initialProfile: {
    fullName: string;
    email: string;
    dateOfBirth: string | null;
    schoolTeam: string | null;
    phone: string | null;
    collegeCommitment: string | null;
    batsHand: string | null;
    throwsHand: string | null;
    assignedCoachUserId: number | null;
    age: number | null;
  };
  coachOptions: Array<{ userId: number; name: string; role: 'admin' | 'coach' }>;
  canAssignCoach: boolean;
  canEditProfile: boolean;
  todayItems: ProgramItemRow[];
  initialWeightLogs: BodyWeightLogRow[];
  initialAssessmentScores: AssessmentWorkoutScoreRow[];
  trackedExercises: TrackedExercise[];
  initialExerciseId: number | null;
  initialTrend: ExerciseTrendPoint[];
};

function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const parsed = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - parsed.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < parsed.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function categoryBubbleStyle(category: string): CSSProperties {
  const hue = hashString(category) % 360;
  return {
    borderColor: `hsla(${hue}, 88%, 64%, 0.7)`,
    background: `hsla(${hue}, 82%, 52%, 0.2)`,
  };
}

function LineChart({
  points,
  yLabel,
  emptyText,
  fixedYMin,
  fixedYMax,
}: {
  points: Array<{ xLabel: string; value: number }>;
  yLabel: string;
  emptyText: string;
  fixedYMin?: number;
  fixedYMax?: number;
}) {
  if (points.length === 0) return <p className="portal-muted-text">{emptyText}</p>;

  const width = 620;
  const height = 230;
  const leftPad = 52;
  const rightPad = 16;
  const topPad = 18;
  const bottomPad = 40;
  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const yMin =
    Number.isFinite(fixedYMin) && Number.isFinite(fixedYMax)
      ? Number(fixedYMin)
      : minValue === maxValue
        ? minValue - 1
        : minValue;
  const yMax =
    Number.isFinite(fixedYMin) && Number.isFinite(fixedYMax)
      ? Number(fixedYMax)
      : minValue === maxValue
        ? maxValue + 1
        : maxValue;
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }, (_, idx) => {
    const ratio = idx / (yTickCount - 1);
    const value = yMax - ratio * (yMax - yMin);
    const y = topPad + ratio * (height - topPad - bottomPad);
    return { value, y };
  });

  const chartPoints = points.map((point, index) => {
    const x =
      points.length === 1
        ? width / 2
        : leftPad + (index / (points.length - 1)) * (width - leftPad - rightPad);
    const y = height - bottomPad - ((point.value - yMin) / (yMax - yMin)) * (height - topPad - bottomPad);
    return { ...point, x, y };
  });

  const path = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const xLabelStep = Math.max(1, Math.ceil(chartPoints.length / 7));
  const xTicks = chartPoints.filter((_, idx) => idx % xLabelStep === 0 || idx === chartPoints.length - 1);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; label: string } | null>(null);

  return (
    <div className="portal-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="portal-chart" role="img" aria-label={yLabel}>
        {yTicks.map((tick) => (
          <g key={`y-${tick.value.toFixed(2)}`}>
            <line
              x1={leftPad}
              y1={tick.y}
              x2={width - rightPad}
              y2={tick.y}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
            <text x={leftPad - 8} y={tick.y + 4} textAnchor="end" fill="rgba(255,255,255,0.72)" fontSize="11">
              {tick.value.toFixed(1)}
            </text>
          </g>
        ))}
        <line x1={leftPad} y1={topPad} x2={leftPad} y2={height - bottomPad} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <line x1={leftPad} y1={height - bottomPad} x2={width - rightPad} y2={height - bottomPad} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <path d={path} fill="none" stroke="rgba(200, 16, 46, 0.95)" strokeWidth="2.6" />
        {xTicks.map((point) => (
          <text
            key={`x-${point.xLabel}-${point.x.toFixed(1)}`}
            x={point.x}
            y={height - 12}
            textAnchor="middle"
            fill="rgba(255,255,255,0.72)"
            fontSize="10"
          >
            {point.xLabel}
          </text>
        ))}
        {chartPoints.map((point) => (
          <circle
            key={`${point.xLabel}-${point.value}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="rgba(200, 16, 46, 0.95)"
            onMouseEnter={(event: MouseEvent<SVGCircleElement>) => {
              setHoveredPoint({
                x: event.currentTarget.cx.baseVal.value,
                y: event.currentTarget.cy.baseVal.value,
                label: `${point.xLabel} - ${point.value.toFixed(1)}`,
              });
            }}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        ))}
        <text x={leftPad} y={12} fill="rgba(255,255,255,0.7)" fontSize="11">
          {yLabel}
        </text>
        {hoveredPoint && (
          <g>
            <rect
              x={Math.max(leftPad + 2, Math.min(hoveredPoint.x - 52, width - rightPad - 120))}
              y={Math.max(topPad + 2, hoveredPoint.y - 28)}
              width="120"
              height="20"
              rx="6"
              fill="rgba(0,0,0,0.92)"
              stroke="rgba(255,255,255,0.28)"
            />
            <text
              x={Math.max(leftPad + 10, Math.min(hoveredPoint.x - 44, width - rightPad - 112))}
              y={Math.max(topPad + 16, hoveredPoint.y - 14)}
              fill="rgba(255,255,255,0.96)"
              fontSize="10"
            >
              {hoveredPoint.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function ProfileDashboard({
  playerId,
  isAdminPreview,
  fullProgramHref,
  initialProfile,
  coachOptions,
  canAssignCoach,
  canEditProfile,
  todayItems,
  initialWeightLogs,
  initialAssessmentScores,
  trackedExercises,
  initialExerciseId,
  initialTrend,
}: ProfileDashboardProps) {
  const [profile, setProfile] = useState({
    fullName: initialProfile.fullName,
    email: initialProfile.email,
    dateOfBirth: initialProfile.dateOfBirth ?? '',
    schoolTeam: initialProfile.schoolTeam ?? '',
    phone: initialProfile.phone ?? '',
    collegeCommitment: initialProfile.collegeCommitment ?? '',
    batsHand: initialProfile.batsHand ?? '',
    throwsHand: initialProfile.throwsHand ?? '',
    assignedCoachUserId: initialProfile.assignedCoachUserId ? String(initialProfile.assignedCoachUserId) : '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

  const [weightDate, setWeightDate] = useState(todayIsoDate());
  const [weightValue, setWeightValue] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightMessage, setWeightMessage] = useState('');
  const [weightLogs, setWeightLogs] = useState<BodyWeightLogRow[]>(initialWeightLogs);
  const [trackedExerciseOptions, setTrackedExerciseOptions] = useState<TrackedExercise[]>(trackedExercises);

  const [selectedExerciseId, setSelectedExerciseId] = useState<number | null>(initialExerciseId);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendMessage, setTrendMessage] = useState('');
  const [trendData, setTrendData] = useState<ExerciseTrendPoint[]>(initialTrend);
  const [profileExpanded, setProfileExpanded] = useState(false);

  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);
  const [selectedAssessmentDate, setSelectedAssessmentDate] = useState(
    initialAssessmentScores[0]?.dayDate ?? ''
  );

  const displayAge = useMemo(() => calculateAge(profile.dateOfBirth || null) ?? initialProfile.age, [initialProfile.age, profile.dateOfBirth]);

  const sortedWeightLogs = useMemo(
    () => [...weightLogs].sort((a, b) => a.logDate.localeCompare(b.logDate)),
    [weightLogs]
  );

  const exerciseTrendPoints = useMemo(
    () => trendData.map((point) => ({ xLabel: formatDate(point.dayDate), value: point.averageLoad })),
    [trendData]
  );

  const weightTrendPoints = useMemo(
    () => sortedWeightLogs.map((log) => ({ xLabel: formatDate(log.logDate), value: log.weightLbs })),
    [sortedWeightLogs]
  );

  const assessmentDates = useMemo(
    () =>
      Array.from(new Set(initialAssessmentScores.map((row) => row.dayDate))).sort((a, b) =>
        b.localeCompare(a)
      ),
    [initialAssessmentScores]
  );

  const visibleAssessmentRows = useMemo(() => {
    if (!selectedAssessmentDate) return [];
    return initialAssessmentScores.filter((row) => row.dayDate === selectedAssessmentDate);
  }, [initialAssessmentScores, selectedAssessmentDate]);

  const selectedDateAssessmentExercises = useMemo(
    () =>
      visibleAssessmentRows.flatMap((row) =>
        row.exerciseScores.map((entry) => ({
          dayDate: row.dayDate,
          workoutName: row.workoutName,
          exerciseId: entry.exerciseId,
          exerciseName: entry.exerciseName,
          prefix: entry.prefix,
          score: entry.score,
          note: entry.note,
        }))
      ),
    [visibleAssessmentRows]
  );

  const assessmentExerciseOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    for (const row of initialAssessmentScores) {
      for (const entry of row.exerciseScores) {
        const name = entry.exerciseName.trim();
        if (!name) continue;
        const key = `${entry.exerciseId ?? 'name'}::${name.toLowerCase()}`;
        if (!map.has(key)) {
          map.set(key, { key, label: name });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [initialAssessmentScores]);

  const [selectedAssessmentExerciseKey, setSelectedAssessmentExerciseKey] = useState<string>(
    assessmentExerciseOptions[0]?.key ?? ''
  );

  useEffect(() => {
    if (!assessmentExerciseOptions.length) {
      setSelectedAssessmentExerciseKey('');
      return;
    }
    if (!assessmentExerciseOptions.some((opt) => opt.key === selectedAssessmentExerciseKey)) {
      setSelectedAssessmentExerciseKey(assessmentExerciseOptions[0].key);
    }
  }, [assessmentExerciseOptions, selectedAssessmentExerciseKey]);

  const assessmentTrendPoints = useMemo(() => {
    if (!selectedAssessmentExerciseKey) return [];
    const [, exerciseNameRaw] = selectedAssessmentExerciseKey.split('::');
    const exerciseNameNeedle = (exerciseNameRaw ?? '').trim();
    if (!exerciseNameNeedle) return [];

    return initialAssessmentScores
      .flatMap((row) =>
        row.exerciseScores
          .filter((entry) => entry.score !== null && entry.exerciseName.trim().toLowerCase() === exerciseNameNeedle)
          .map((entry) => ({
            xLabel: formatDate(row.dayDate),
            value: Number(entry.score),
            dayDate: row.dayDate,
          }))
      )
      .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
      .map((point) => ({ xLabel: point.xLabel, value: point.value }));
  }, [initialAssessmentScores, selectedAssessmentExerciseKey]);

  useEffect(() => {
    let cancelled = false;
    const loadTrackedExercises = async () => {
      try {
        const params = new URLSearchParams({ playerId: String(playerId) });
        const response = await fetch(`/api/player/tracked-exercises?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          exercises?: TrackedExercise[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load tracked exercises.');
        if (cancelled) return;
        const options = Array.isArray(payload.exercises) ? payload.exercises : [];
        setTrackedExerciseOptions(options);
        setSelectedExerciseId((current) => current ?? options[0]?.exerciseId ?? null);
      } catch {
        if (cancelled) return;
        setTrackedExerciseOptions([]);
      }
    };

    void loadTrackedExercises();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    if (!selectedExerciseId) {
      setTrendData([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setTrendLoading(true);
      setTrendMessage('');
      try {
        const params = new URLSearchParams({
          playerId: String(playerId),
          exerciseId: String(selectedExerciseId),
        });
        const response = await fetch(`/api/player/exercise-trend?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          trend?: ExerciseTrendPoint[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load exercise trend.');
        if (cancelled) return;
        setTrendData(Array.isArray(payload.trend) ? payload.trend : []);
      } catch (error) {
        if (cancelled) return;
        setTrendData([]);
        setTrendMessage(error instanceof Error ? error.message : 'Failed to load exercise trend.');
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [playerId, selectedExerciseId]);

  return (
    <div className="portal-profile-stack">
      <section className="portal-admin-card portal-profile-hero">
        <div className="portal-profile-hero-name">
          <h2>{profile.fullName}</h2>
        </div>
        <div className="portal-profile-vitals">
          <span className="portal-profile-vitals-text">
            Age: {displayAge ?? '-'}
            {'\u00A0\u00A0\u00A0\u00A0\u00A0'}
            Bats: {profile.batsHand || '-'}
            {'\u00A0\u00A0\u00A0\u00A0\u00A0'}
            Throws: {profile.throwsHand || '-'}
          </span>
        </div>
      </section>

      <article className="portal-admin-card">
        <div className="portal-row-between">
          <h3>Profile Details</h3>
          {canEditProfile ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setProfileExpanded((current) => !current)}
              aria-expanded={profileExpanded}
            >
              {profileExpanded ? 'Collapse' : 'Expand'}
            </button>
          ) : null}
        </div>
        {canEditProfile && profileExpanded ? (
          <form
            className="portal-form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setProfileSaving(true);
              setProfileMessage('');
              try {
                const response = await fetch('/api/player/profile', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    playerId,
                    fullName: profile.fullName,
                    email: profile.email,
                    dateOfBirth: profile.dateOfBirth,
                    schoolTeam: profile.schoolTeam,
                    phone: profile.phone,
                    collegeCommitment: profile.collegeCommitment,
                    batsHand: profile.batsHand,
                    throwsHand: profile.throwsHand,
                    assignedCoachUserId: profile.assignedCoachUserId ? Number(profile.assignedCoachUserId) : null,
                  }),
                });
                const payload = (await response.json().catch(() => ({}))) as { error?: string };
                if (!response.ok) throw new Error(payload.error ?? 'Failed to save profile.');
                setProfileMessage('Profile saved.');
              } catch (error) {
                setProfileMessage(error instanceof Error ? error.message : 'Failed to save profile.');
              } finally {
                setProfileSaving(false);
              }
            }}
          >
            <label>
              Name
              <input
                value={profile.fullName}
                onChange={(event) => setProfile((prev) => ({ ...prev, fullName: event.target.value }))}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={profile.email}
                onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Date Of Birth
              <input
                type="date"
                value={profile.dateOfBirth}
                onChange={(event) => setProfile((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
              />
            </label>
            <label>
              School / Team
              <input
                value={profile.schoolTeam}
                onChange={(event) => setProfile((prev) => ({ ...prev, schoolTeam: event.target.value }))}
              />
            </label>
            <label>
              Phone
              <input
                value={profile.phone}
                onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </label>
            <label>
              College Commitment
              <input
                value={profile.collegeCommitment}
                onChange={(event) => setProfile((prev) => ({ ...prev, collegeCommitment: event.target.value }))}
              />
            </label>
            <label>
              Bats
              <select value={profile.batsHand} onChange={(event) => setProfile((prev) => ({ ...prev, batsHand: event.target.value }))}>
                <option value="">-</option>
                <option value="Right">Right</option>
                <option value="Left">Left</option>
                <option value="Switch">Switch</option>
              </select>
            </label>
            <label>
              Throws
              <select value={profile.throwsHand} onChange={(event) => setProfile((prev) => ({ ...prev, throwsHand: event.target.value }))}>
                <option value="">-</option>
                <option value="Right">Right</option>
                <option value="Left">Left</option>
              </select>
            </label>
            <label>
              Assigned Coach
              <select
                value={profile.assignedCoachUserId}
                onChange={(event) => setProfile((prev) => ({ ...prev, assignedCoachUserId: event.target.value }))}
                disabled={!canAssignCoach}
              >
                <option value="">Unassigned</option>
                {coachOptions.map((coach) => (
                  <option key={coach.userId} value={String(coach.userId)}>
                    {coach.name} ({coach.role})
                  </option>
                ))}
              </select>
            </label>
            <div className="portal-choice-line-actions">
              <button type="submit" className="btn btn-primary" disabled={profileSaving}>
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
              {profileMessage && (
                <p className={profileMessage === 'Profile saved.' ? 'auth-message' : 'auth-error'}>{profileMessage}</p>
              )}
            </div>
          </form>
        ) : null}
        {!canEditProfile ? (
          <div className="portal-form-grid">
            <label>
              Name
              <input value={profile.fullName} readOnly />
            </label>
            <label>
              Email
              <input value={profile.email} readOnly />
            </label>
            <label>
              Date Of Birth
              <input value={profile.dateOfBirth || '-'} readOnly />
            </label>
            <label>
              School / Team
              <input value={profile.schoolTeam || '-'} readOnly />
            </label>
            <label>
              Phone
              <input value={profile.phone || '-'} readOnly />
            </label>
            <label>
              College Commitment
              <input value={profile.collegeCommitment || '-'} readOnly />
            </label>
            <label>
              Bats
              <input value={profile.batsHand || '-'} readOnly />
            </label>
            <label>
              Throws
              <input value={profile.throwsHand || '-'} readOnly />
            </label>
          </div>
        ) : null}
      </article>

      <article className="portal-admin-card">
        <div className="portal-row-between">
          <h3>Assessment Scores</h3>
          {assessmentDates.length > 0 && (
            <label className="portal-inline-filter">
              Date
              <select
                value={selectedAssessmentDate}
                onChange={(event) => setSelectedAssessmentDate(event.target.value)}
              >
                {assessmentDates.map((date) => (
                  <option key={date} value={date}>
                    {formatDate(date)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {visibleAssessmentRows.length === 0 ? (
          <p className="portal-muted-text">No assessment scores logged yet.</p>
        ) : (
          <div
            className="portal-profile-assessment-split"
            style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '0.85rem' }}
          >
            <div className="portal-admin-stack">
              <h4 style={{ margin: 0 }}>Scores For {formatDate(selectedAssessmentDate)}</h4>
              <div
                className="portal-profile-assessment-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.55rem' }}
              >
                {selectedDateAssessmentExercises.map((entry, idx) => {
                  const score = entry.score;
                  const style =
                    score === 3
                      ? { borderColor: 'rgba(66, 214, 133, 0.8)', background: 'rgba(32, 150, 91, 0.2)' }
                      : score === 2
                        ? { borderColor: 'rgba(245, 212, 78, 0.8)', background: 'rgba(168, 138, 36, 0.2)' }
                        : score === 1
                          ? { borderColor: 'rgba(246, 97, 97, 0.8)', background: 'rgba(165, 41, 41, 0.2)' }
                          : { borderColor: 'rgba(255,255,255,0.24)', background: 'rgba(255,255,255,0.06)' };
                  return (
                    <article
                      key={`${entry.dayDate}-${entry.workoutName}-${entry.exerciseName}-${idx}`}
                      className="portal-day-card"
                      style={style}
                    >
                      <h4 style={{ margin: 0 }}>
                        {entry.prefix ? `${entry.prefix} ` : ''}
                        {entry.exerciseName}
                      </h4>
                      <p style={{ margin: 0, fontWeight: 700 }}>Score: {score ?? '-'}</p>
                      {entry.note ? <p className="portal-muted-text">Notes: {entry.note}</p> : null}
                    </article>
                  );
                })}
              </div>
            </div>
            <article className="portal-admin-card">
              <h4 style={{ margin: 0 }}>Assessment Trend</h4>
              <select
                aria-label="Assessment exercise"
                value={selectedAssessmentExerciseKey}
                onChange={(event) => setSelectedAssessmentExerciseKey(event.target.value)}
              >
                {assessmentExerciseOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <LineChart
                points={assessmentTrendPoints}
                yLabel="Score (1-3)"
                emptyText="No scores logged yet for this assessment."
                fixedYMin={1}
                fixedYMax={3}
              />
            </article>
          </div>
        )}
      </article>

      <div className="portal-profile-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.85rem' }}>
        <article className="portal-admin-card">
          <div className="portal-row-between">
            <h3>Today&apos;s Schedule</h3>
            <Link className="btn btn-ghost as-link" href={fullProgramHref}>
              Click for Full Program
            </Link>
          </div>
          {todayItems.length === 0 ? (
            <p className="portal-muted-text">No workouts assigned for today.</p>
          ) : (
            <div className="portal-player-items">
              {todayItems.map((item) => (
                <button
                  key={item.itemId}
                  type="button"
                  className="portal-schedule-item"
                  style={categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout')}
                  onClick={() => setSelectedItem(item)}
                >
                  <strong>{item.itemName}</strong>
                </button>
              ))}
            </div>
          )}
          {isAdminPreview && <p className="portal-muted-text">Preview mode: updates are saved to this player.</p>}
        </article>

        <article className="portal-admin-card">
          <h3>Exercise Load Trend</h3>
          <select
            aria-label="Exercise"
            value={selectedExerciseId ? String(selectedExerciseId) : ''}
            onChange={(event) => setSelectedExerciseId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Select exercise</option>
            {trackedExerciseOptions.map((exercise) => (
              <option key={exercise.exerciseId} value={String(exercise.exerciseId)}>
                {exercise.name} ({exercise.category})
              </option>
            ))}
          </select>
          {trendLoading ? <p className="portal-muted-text">Loading trend...</p> : null}
          {trendMessage ? <p className="auth-error">{trendMessage}</p> : null}
          <LineChart points={exerciseTrendPoints} yLabel="Avg load (lbs)" emptyText="No logged loads yet for this exercise." />
        </article>
        <article className="portal-admin-card">
          <h3>Body Weight Log</h3>
          <form
            className="portal-form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setWeightSaving(true);
              setWeightMessage('');
              try {
                const response = await fetch('/api/player/weight-logs', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    playerId,
                    logDate: weightDate,
                    weightLbs: Number(weightValue),
                    notes: weightNotes,
                  }),
                });
                const payload = (await response.json().catch(() => ({}))) as {
                  logs?: BodyWeightLogRow[];
                  error?: string;
                };
                if (!response.ok) throw new Error(payload.error ?? 'Failed to save body weight entry.');
                setWeightLogs(Array.isArray(payload.logs) ? payload.logs : []);
                setWeightValue('');
                setWeightNotes('');
                setWeightMessage('Body weight saved.');
              } catch (error) {
                setWeightMessage(error instanceof Error ? error.message : 'Failed to save body weight entry.');
              } finally {
                setWeightSaving(false);
              }
            }}
          >
            <label>
              Date
              <input type="date" value={weightDate} onChange={(event) => setWeightDate(event.target.value)} required />
            </label>
            <label>
              Weight (lbs)
              <input
                type="number"
                step="0.1"
                min="1"
                value={weightValue}
                onChange={(event) => setWeightValue(event.target.value)}
                required
              />
            </label>
            <label className="portal-form-span-2">
              Notes
              <input value={weightNotes} onChange={(event) => setWeightNotes(event.target.value)} />
            </label>
            <div className="portal-choice-line-actions">
              <button type="submit" className="btn btn-primary" disabled={weightSaving}>
                {weightSaving ? 'Saving...' : 'Save Weight'}
              </button>
              {weightMessage && (
                <p className={weightMessage === 'Body weight saved.' ? 'auth-message' : 'auth-error'}>{weightMessage}</p>
              )}
            </div>
          </form>

          <LineChart points={weightTrendPoints} yLabel="Body weight (lbs)" emptyText="No body weight entries yet." />
        </article>
      </div>

      {selectedItem && (
        <WorkoutLogModal
          item={selectedItem}
          playerId={playerId}
          onClose={() => setSelectedItem(null)}
          onSaved={() => {
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
