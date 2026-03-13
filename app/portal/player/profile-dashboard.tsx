'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import type {
  AssessmentWorkoutScoreRow,
  BodyWeightLogRow,
  CompletedPlayerPlanGoalRow,
  PlayerPlanGoalRow,
  ProgramItemRow,
} from '../../../lib/training-db';
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

const PLAN_GOAL_CATEGORIES = ['Mechanical', 'Stuff', 'Command', 'Mental Side', 'Strength', 'Mobility'] as const;

type GoalDraft = {
  slotIndex: 1 | 2 | 3;
  category: string;
  goalDescription: string;
  createdAt: string | null;
};

type PhotoCropState = {
  sourceDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

type ProfileDashboardProps = {
  playerId: number;
  sessionRole: 'admin' | 'coach' | 'player';
  isAdminPreview: boolean;
  fullProgramHref: string;
  initialProfile: {
    fullName: string;
    email: string;
    dateOfBirth: string | null;
    schoolTeam: string | null;
    phone: string | null;
    collegeCommitment: string | null;
    gradYear: string | null;
    position: string | null;
    batsHand: string | null;
    throwsHand: string | null;
    height: string | null;
    profileWeightLbs: number | null;
    profilePhotoDataUrl: string | null;
    assignedCoachUserId: number | null;
    age: number | null;
  };
  coachOptions: Array<{ userId: number; name: string; role: 'admin' | 'coach' }>;
  canAssignCoach: boolean;
  canEditProfile: boolean;
  todayItems: ProgramItemRow[];
  initialWeightLogs: BodyWeightLogRow[];
  initialAssessmentScores: AssessmentWorkoutScoreRow[];
  initialPlanGoals: PlayerPlanGoalRow[];
  initialCompletedPlanGoals: CompletedPlayerPlanGoalRow[];
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

function formatTimestampDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
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

function toInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(sourceDataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image.'));
    img.src = sourceDataUrl;
  });
}

async function renderCroppedProfilePhoto(input: {
  sourceDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}): Promise<string> {
  const { sourceDataUrl, imageWidth, imageHeight, zoom, offsetX, offsetY } = input;
  const image = await loadImageElement(sourceDataUrl);

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image.');

  // Start from full/default framing (entire image visible), then let user zoom in.
  const baseScale = Math.min(size / imageWidth, size / imageHeight);
  const drawScale = baseScale * Math.max(1, zoom);
  const drawWidth = imageWidth * drawScale;
  const drawHeight = imageHeight * drawScale;
  const drawX = (size - drawWidth) / 2 + offsetX;
  const drawY = (size - drawHeight) / 2 + offsetY;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();
  return canvas.toDataURL('image/png');
}

function LineChart({
  points,
  yLabel,
  emptyText,
  fixedYMin,
  fixedYMax,
  chartHeight = 230,
}: {
  points: Array<{ xLabel: string; value: number }>;
  yLabel: string;
  emptyText: string;
  fixedYMin?: number;
  fixedYMax?: number;
  chartHeight?: number;
}) {
  if (points.length === 0) return <p className="portal-muted-text">{emptyText}</p>;

  const width = 620;
  const height = chartHeight;
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
  const useIntegerTicks = Number.isInteger(yMin) && Number.isInteger(yMax) && yMax - yMin <= 10;
  const yTicks = useIntegerTicks
    ? Array.from({ length: yMax - yMin + 1 }, (_, idx) => {
        const value = yMax - idx;
        const ratio = (yMax - value) / Math.max(1, yMax - yMin);
        const y = topPad + ratio * (height - topPad - bottomPad);
        return { value, y };
      })
    : Array.from({ length: yTickCount }, (_, idx) => {
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
              {Number.isInteger(tick.value) ? String(tick.value) : tick.value.toFixed(1)}
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
  sessionRole,
  isAdminPreview,
  fullProgramHref,
  initialProfile,
  coachOptions,
  canAssignCoach,
  canEditProfile,
  todayItems,
  initialWeightLogs,
  initialAssessmentScores,
  initialPlanGoals,
  initialCompletedPlanGoals,
  trackedExercises,
  initialExerciseId,
  initialTrend,
}: ProfileDashboardProps) {
  const canManageGoals = sessionRole === 'admin' || sessionRole === 'coach';
  const showProfileDetailsPanel = sessionRole !== 'player';
  const [profile, setProfile] = useState({
    fullName: initialProfile.fullName,
    email: initialProfile.email,
    dateOfBirth: initialProfile.dateOfBirth ?? '',
    schoolTeam: initialProfile.schoolTeam ?? '',
    phone: initialProfile.phone ?? '',
    collegeCommitment: initialProfile.collegeCommitment ?? '',
    gradYear: initialProfile.gradYear ?? '',
    position: initialProfile.position ?? '',
    batsHand: initialProfile.batsHand ?? '',
    throwsHand: initialProfile.throwsHand ?? '',
    height: initialProfile.height ?? '',
    profileWeightLbs:
      initialProfile.profileWeightLbs !== null && Number.isFinite(initialProfile.profileWeightLbs)
        ? String(initialProfile.profileWeightLbs)
        : '',
    profilePhotoDataUrl: initialProfile.profilePhotoDataUrl ?? '',
    assignedCoachUserId: initialProfile.assignedCoachUserId ? String(initialProfile.assignedCoachUserId) : '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMessage, setPhotoMessage] = useState('');
  const [photoCropState, setPhotoCropState] = useState<PhotoCropState | null>(null);
  const [photoDragging, setPhotoDragging] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const pinchRef = useRef<{
    active: boolean;
    startDistance: number;
    startZoom: number;
  } | null>(null);
  const pointerMapRef = useRef<Map<number, { x: number; y: number }>>(new Map());

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
  const [assessmentExpanded, setAssessmentExpanded] = useState(true);

  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);
  const [planGoals, setPlanGoals] = useState<GoalDraft[]>(
    [1, 2, 3].map((slot) => {
      const existing = initialPlanGoals.find((goal) => goal.slotIndex === slot);
      return {
        slotIndex: slot as 1 | 2 | 3,
        category: existing?.category ?? '',
        goalDescription: existing?.goalDescription ?? '',
        createdAt: existing?.createdAt ?? null,
      };
    })
  );
  const [completedPlanGoals, setCompletedPlanGoals] = useState<CompletedPlayerPlanGoalRow[]>(initialCompletedPlanGoals);
  const [goalSavingSlot, setGoalSavingSlot] = useState<1 | 2 | 3 | null>(null);
  const [goalMessage, setGoalMessage] = useState('');
  const [showCompletedGoals, setShowCompletedGoals] = useState(false);
  const [completeModal, setCompleteModal] = useState<{ slotIndex: 1 | 2 | 3; details: string } | null>(null);
  const [completingGoal, setCompletingGoal] = useState(false);
  const [planGoalsExpanded, setPlanGoalsExpanded] = useState(sessionRole !== 'player');
  const [selectedAssessmentDate, setSelectedAssessmentDate] = useState(
    initialAssessmentScores[0]?.dayDate ?? ''
  );

  const sortedWeightLogs = useMemo(
    () => [...weightLogs].sort((a, b) => a.logDate.localeCompare(b.logDate)),
    [weightLogs]
  );
  const latestWeightLog = sortedWeightLogs.length > 0 ? sortedWeightLogs[sortedWeightLogs.length - 1] : null;
  const fallbackProfileWeight = Number(profile.profileWeightLbs);
  const effectiveProfileWeight =
    latestWeightLog?.weightLbs ??
    (Number.isFinite(fallbackProfileWeight) && fallbackProfileWeight > 0 ? fallbackProfileWeight : null);

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
    if (typeof window === 'undefined') return;
    setAssessmentExpanded(!window.matchMedia('(max-width: 780px)').matches);
  }, []);

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

  const saveGoal = async (slotIndex: 1 | 2 | 3) => {
    if (!canManageGoals) return;
    const goal = planGoals.find((entry) => entry.slotIndex === slotIndex);
    if (!goal) return;
    setGoalSavingSlot(slotIndex);
    setGoalMessage('');
    try {
      const response = await fetch('/api/player/plan-goals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          slotIndex,
          category: goal.category,
          goalDescription: goal.goalDescription,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        activeGoals?: PlayerPlanGoalRow[];
        completedGoals?: CompletedPlayerPlanGoalRow[];
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save goal.');
      const nextActive = Array.isArray(payload.activeGoals) ? payload.activeGoals : [];
      setPlanGoals((prev) =>
        [1, 2, 3].map((slot) => {
          const local = prev.find((entry) => entry.slotIndex === slot) ?? {
            slotIndex: slot as 1 | 2 | 3,
            category: '',
            goalDescription: '',
            createdAt: null,
          };
          const server = nextActive.find((entry) => entry.slotIndex === slot);
          if (slot === slotIndex) {
            return {
              slotIndex: slot as 1 | 2 | 3,
              category: server?.category ?? local.category,
              goalDescription: server?.goalDescription ?? local.goalDescription,
              createdAt: server?.createdAt ?? local.createdAt,
            };
          }
          if (server?.category || server?.goalDescription || server?.createdAt) {
            return {
              slotIndex: slot as 1 | 2 | 3,
              category: server.category ?? '',
              goalDescription: server.goalDescription ?? '',
              createdAt: server.createdAt ?? null,
            };
          }
          return local;
        })
      );
      if (Array.isArray(payload.completedGoals)) setCompletedPlanGoals(payload.completedGoals);
      setGoalMessage(`Goal ${slotIndex} saved.`);
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : 'Failed to save goal.');
    } finally {
      setGoalSavingSlot(null);
    }
  };

  const saveGoalCompletion = async () => {
    if (!canManageGoals || !completeModal) return;
    setCompletingGoal(true);
    setGoalMessage('');
    try {
      const response = await fetch('/api/player/plan-goals', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          slotIndex: completeModal.slotIndex,
          completionDetails: completeModal.details,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        activeGoals?: PlayerPlanGoalRow[];
        completedGoals?: CompletedPlayerPlanGoalRow[];
      };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to complete goal.');
      const nextActive = Array.isArray(payload.activeGoals) ? payload.activeGoals : [];
      setPlanGoals((prev) =>
        [1, 2, 3].map((slot) => {
          const local = prev.find((entry) => entry.slotIndex === slot) ?? {
            slotIndex: slot as 1 | 2 | 3,
            category: '',
            goalDescription: '',
            createdAt: null,
          };
          const server = nextActive.find((entry) => entry.slotIndex === slot);
          if (slot === completeModal.slotIndex) {
            return {
              slotIndex: slot as 1 | 2 | 3,
              category: server?.category ?? '',
              goalDescription: server?.goalDescription ?? '',
              createdAt: server?.createdAt ?? null,
            };
          }
          if (server?.category || server?.goalDescription || server?.createdAt) {
            return {
              slotIndex: slot as 1 | 2 | 3,
              category: server.category ?? '',
              goalDescription: server.goalDescription ?? '',
              createdAt: server.createdAt ?? null,
            };
          }
          return local;
        })
      );
      if (Array.isArray(payload.completedGoals)) setCompletedPlanGoals(payload.completedGoals);
      setCompleteModal(null);
      setGoalMessage(`Goal ${completeModal.slotIndex} marked complete.`);
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : 'Failed to complete goal.');
    } finally {
      setCompletingGoal(false);
    }
  };

  const saveProfilePayload = async (nextProfile: typeof profile) => {
    const response = await fetch('/api/player/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId,
        fullName: nextProfile.fullName,
        email: nextProfile.email,
        dateOfBirth: nextProfile.dateOfBirth,
        schoolTeam: nextProfile.schoolTeam,
        phone: nextProfile.phone,
        collegeCommitment: nextProfile.collegeCommitment,
        gradYear: nextProfile.gradYear,
        position: nextProfile.position,
        batsHand: nextProfile.batsHand,
        throwsHand: nextProfile.throwsHand,
        height: nextProfile.height,
        profileWeightLbs: nextProfile.profileWeightLbs ? Number(nextProfile.profileWeightLbs) : null,
        profilePhotoDataUrl: nextProfile.profilePhotoDataUrl || null,
        assignedCoachUserId: nextProfile.assignedCoachUserId ? Number(nextProfile.assignedCoachUserId) : null,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Failed to save profile.');
  };

  const onPhotoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoMessage('Please choose an image file.');
      event.target.value = '';
      return;
    }
    if (file.size > 2_000_000) {
      setPhotoMessage('Image is too large. Please keep it under 2MB.');
      event.target.value = '';
      return;
    }

    const dataUrl = await readFileAsDataUrl(file).catch((error) => {
      setPhotoMessage(error instanceof Error ? error.message : 'Could not read image file.');
      return '';
    });

    event.target.value = '';
    if (!dataUrl) return;
    const image = await loadImageElement(dataUrl).catch((error) => {
      setPhotoMessage(error instanceof Error ? error.message : 'Could not load selected image.');
      return null;
    });
    if (!image) return;
    setPhotoMessage('');
    setPhotoCropState({
      sourceDataUrl: dataUrl,
      imageWidth: image.naturalWidth || image.width,
      imageHeight: image.naturalHeight || image.height,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    });
  };

  const saveCroppedPhoto = async () => {
    if (!photoCropState) return;
    setPhotoUploading(true);
    setPhotoMessage('');
    try {
      const croppedDataUrl = await renderCroppedProfilePhoto(photoCropState);
      const nextProfile = { ...profile, profilePhotoDataUrl: croppedDataUrl };
      await saveProfilePayload(nextProfile);
      setProfile(nextProfile);
      setPhotoCropState(null);
      setPhotoMessage('Profile photo updated.');
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : 'Failed to update profile photo.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const onCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!photoCropState) return;
    pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerMapRef.current.size === 2) {
      const points = Array.from(pointerMapRef.current.values());
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      pinchRef.current = {
        active: true,
        startDistance: Math.hypot(dx, dy),
        startZoom: photoCropState.zoom,
      };
      photoDragRef.current = null;
      setPhotoDragging(false);
    }
    if (pointerMapRef.current.size > 1) {
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    photoDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: photoCropState.offsetX,
      baseY: photoCropState.offsetY,
    };
    setPhotoDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerMapRef.current.has(event.pointerId)) {
      pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinchRef.current?.active && photoCropState && pointerMapRef.current.size >= 2) {
      const points = Array.from(pointerMapRef.current.values());
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      const distance = Math.hypot(dx, dy);
      const ratio = pinchRef.current.startDistance > 0 ? distance / pinchRef.current.startDistance : 1;
      const nextZoom = Math.min(4, Math.max(1, pinchRef.current.startZoom * ratio));
      setPhotoCropState((prev) => (prev ? { ...prev, zoom: nextZoom } : prev));
      return;
    }
    const drag = photoDragRef.current;
    if (!drag || !photoCropState || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setPhotoCropState((prev) => (prev ? { ...prev, offsetX: drag.baseX + dx, offsetY: drag.baseY + dy } : prev));
  };

  const onCropPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerMapRef.current.delete(event.pointerId);
    if (pointerMapRef.current.size < 2) pinchRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = photoDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    photoDragRef.current = null;
    setPhotoDragging(false);
  };

  const gradYearValue = profile.gradYear.trim();
  const positionValue = profile.position.trim();
  const heightValue = profile.height.trim();
  const roundedWeight = effectiveProfileWeight !== null ? Math.round(effectiveProfileWeight) : null;
  const heroGradPositionLine =
    gradYearValue && positionValue ? `${gradYearValue} ${positionValue}` : gradYearValue || positionValue || '';
  const heroHeightWeightLine =
    heightValue && roundedWeight !== null
      ? `${heightValue} ${roundedWeight} lbs.`
      : heightValue || (roundedWeight !== null ? `${roundedWeight} lbs.` : '');
  const heroCommitLine = profile.collegeCommitment.trim() ? `${profile.collegeCommitment.trim()} Commit` : '';

  return (
    <div className="portal-profile-stack">
      <section className="portal-admin-card portal-profile-hero">
        <div className="portal-profile-hero-photo">
          {profile.profilePhotoDataUrl ? (
            <img src={profile.profilePhotoDataUrl} alt={`${profile.fullName} profile`} className="portal-profile-avatar-image" />
          ) : (
            <div className="portal-profile-avatar-fallback" aria-label="Profile photo placeholder">
              {toInitials(profile.fullName)}
            </div>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void onPhotoSelected(event)}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-ghost portal-profile-photo-btn"
            onClick={() => photoInputRef.current?.click()}
            disabled={photoUploading}
          >
            {photoUploading ? 'Uploading...' : 'Upload Photo'}
          </button>
        </div>
        <div className="portal-profile-hero-main">
          <div className="portal-profile-hero-name">
            <h2>{profile.fullName}</h2>
          </div>
          {heroGradPositionLine ? <p className="portal-profile-hero-line">{heroGradPositionLine}</p> : null}
          {heroHeightWeightLine ? <p className="portal-profile-hero-line">{heroHeightWeightLine}</p> : null}
          {heroCommitLine ? <p className="portal-profile-hero-line">{heroCommitLine}</p> : null}
        </div>
        {photoMessage ? <p className={photoMessage === 'Profile photo updated.' ? 'auth-message' : 'auth-error'}>{photoMessage}</p> : null}
      </section>

      {showProfileDetailsPanel && (
        <article className="portal-admin-card">
        <div className="portal-row-between">
          <h3>Profile Details</h3>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setProfileExpanded((current) => !current)}
            aria-expanded={profileExpanded}
          >
            {profileExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {canEditProfile && profileExpanded ? (
          <form
            className="portal-form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setProfileSaving(true);
              setProfileMessage('');
              try {
                await saveProfilePayload(profile);
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
              Grad Year
              <input
                value={profile.gradYear}
                onChange={(event) => setProfile((prev) => ({ ...prev, gradYear: event.target.value }))}
              />
            </label>
            <label>
              Position
              <input
                value={profile.position}
                onChange={(event) => setProfile((prev) => ({ ...prev, position: event.target.value }))}
              />
            </label>
            <label>
              Height
              <input
                value={profile.height}
                onChange={(event) => setProfile((prev) => ({ ...prev, height: event.target.value }))}
                placeholder={`6'2"`}
              />
            </label>
            <label>
              Profile Weight (lbs)
              <input
                type="number"
                step="1"
                min="1"
                value={profile.profileWeightLbs}
                onChange={(event) => setProfile((prev) => ({ ...prev, profileWeightLbs: event.target.value }))}
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
        {!canEditProfile && profileExpanded ? (
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
              Grad Year
              <input value={profile.gradYear || '-'} readOnly />
            </label>
            <label>
              Position
              <input value={profile.position || '-'} readOnly />
            </label>
            <label>
              Height
              <input value={profile.height || '-'} readOnly />
            </label>
            <label>
              Profile Weight (lbs)
              <input value={profile.profileWeightLbs || '-'} readOnly />
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
      )}

      <article className="portal-admin-card">
        <div className="portal-row-between">
          <h3>Player Plan Goals</h3>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPlanGoalsExpanded((current) => !current)}
            aria-expanded={planGoalsExpanded}
          >
            {planGoalsExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {!planGoalsExpanded ? null : (
          <>
            <div className="portal-profile-goals-grid">
              {planGoals.map((goal) => (
                <article key={`goal-slot-${goal.slotIndex}`} className="portal-day-card">
                  <div className="portal-row-between">
                    <h4 style={{ margin: 0 }}>Goal {goal.slotIndex}</h4>
                    <p className="portal-muted-text">Created: {formatTimestampDate(goal.createdAt)}</p>
                  </div>
                  <label className="portal-inline-filter">
                    Category
                    <select
                      value={goal.category}
                      disabled={!canManageGoals}
                      onChange={(event) =>
                        setPlanGoals((prev) =>
                          prev.map((entry) =>
                            entry.slotIndex === goal.slotIndex ? { ...entry, category: event.target.value } : entry
                          )
                        )
                      }
                    >
                      <option value="">Select category</option>
                      {PLAN_GOAL_CATEGORIES.map((category) => (
                        <option key={`${goal.slotIndex}-${category}`} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="portal-inline-filter">
                    Goal
                    <textarea
                      rows={4}
                      value={goal.goalDescription}
                      readOnly={!canManageGoals}
                      onChange={(event) =>
                        setPlanGoals((prev) =>
                          prev.map((entry) =>
                            entry.slotIndex === goal.slotIndex ? { ...entry, goalDescription: event.target.value } : entry
                          )
                        )
                      }
                    />
                  </label>
                  {canManageGoals ? (
                    <div className="portal-choice-line-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void saveGoal(goal.slotIndex)}
                        disabled={goalSavingSlot === goal.slotIndex}
                      >
                        {goalSavingSlot === goal.slotIndex ? 'Saving...' : 'Save Goal'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!goal.category || !goal.goalDescription.trim()}
                        onClick={() => setCompleteModal({ slotIndex: goal.slotIndex, details: '' })}
                      >
                        Completed Goal
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="portal-choice-line-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCompletedGoals((current) => !current)}>
                {showCompletedGoals ? 'Hide Completed Goals' : 'View Completed Goals'}
              </button>
              {goalMessage ? <p className={goalMessage.includes('Failed') ? 'auth-error' : 'auth-message'}>{goalMessage}</p> : null}
            </div>
            {showCompletedGoals ? (
              completedPlanGoals.length === 0 ? (
                <p className="portal-muted-text">No completed goals yet.</p>
              ) : (
                <div className="portal-admin-stack">
                  {completedPlanGoals.map((goal) => (
                    <article key={`completed-goal-${goal.id}`} className="portal-day-card">
                      <div className="portal-row-between">
                        <h4 style={{ margin: 0 }}>{goal.category}</h4>
                        <p className="portal-muted-text">{formatTimestampDate(goal.completedAt)}</p>
                      </div>
                      <p style={{ margin: 0 }}>{goal.goalDescription}</p>
                      {goal.completionDetails ? <p className="portal-muted-text">Details: {goal.completionDetails}</p> : null}
                    </article>
                  ))}
                </div>
              )
            ) : null}
          </>
        )}
      </article>

      <article className="portal-admin-card">
        <div className="portal-row-between">
          <h3>Assessment Scores</h3>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setAssessmentExpanded((current) => !current)}
            aria-expanded={assessmentExpanded}
          >
            {assessmentExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {assessmentDates.length > 0 && (
          <label className="portal-inline-filter" style={{ maxWidth: '220px' }}>
            Date
            <select value={selectedAssessmentDate} onChange={(event) => setSelectedAssessmentDate(event.target.value)}>
              {assessmentDates.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))}
            </select>
          </label>
        )}
        {!assessmentExpanded ? null : visibleAssessmentRows.length === 0 ? (
          <p className="portal-muted-text">No assessment scores logged yet.</p>
        ) : (
          <div className="portal-profile-assessment-split">
            <div className="portal-admin-stack">
              <h4 style={{ margin: 0 }}>Scores For {formatDate(selectedAssessmentDate)}</h4>
              <div className="portal-profile-assessment-grid">
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
                className="portal-assessment-trend-select"
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
                fixedYMin={0}
                fixedYMax={3}
                chartHeight={280}
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
        </article>

        <article className="portal-admin-card">
          <h3>Exercise Load Trend</h3>
          <select
            className="portal-assessment-trend-select"
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
                step="1"
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

      {photoCropState ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.86)',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
          }}
          onClick={() => {
            if (photoUploading) return;
            setPhotoCropState(null);
          }}
        >
          <article
            className="portal-admin-card"
            style={{ width: 'min(560px, 96vw)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ margin: 0 }}>Crop Profile Photo</h3>
            <div
              style={{
                width: '260px',
                height: '260px',
                borderRadius: '999px',
                border: '1px solid rgba(255,255,255,0.22)',
                overflow: 'hidden',
                margin: '0.2rem auto 0',
                position: 'relative',
                background: 'rgba(0,0,0,0.6)',
                touchAction: 'none',
                userSelect: 'none',
                cursor: photoDragging ? 'grabbing' : 'grab',
              }}
              onPointerDown={onCropPointerDown}
              onPointerMove={onCropPointerMove}
              onPointerUp={onCropPointerUp}
              onPointerCancel={onCropPointerUp}
            >
              <img
                src={photoCropState.sourceDataUrl}
                alt="Crop preview"
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: `${photoCropState.imageWidth * Math.min(260 / photoCropState.imageWidth, 260 / photoCropState.imageHeight)}px`,
                  height: `${photoCropState.imageHeight * Math.min(260 / photoCropState.imageWidth, 260 / photoCropState.imageHeight)}px`,
                  transform: `translate(calc(-50% + ${photoCropState.offsetX}px), calc(-50% + ${photoCropState.offsetY}px)) scale(${photoCropState.zoom})`,
                  transformOrigin: 'center center',
                  maxWidth: 'none',
                  maxHeight: 'none',
                }}
              />
            </div>
            <p className="portal-muted-text" style={{ textAlign: 'center' }}>
              Drag to reposition. Pinch with two fingers to zoom.
            </p>
            <div className="portal-choice-line-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPhotoCropState(null)} disabled={photoUploading}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveCroppedPhoto()} disabled={photoUploading}>
                {photoUploading ? 'Saving...' : 'Use Photo'}
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {completeModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            background: 'rgba(0,0,0,0.86)',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
          }}
          onClick={() => {
            if (completingGoal) return;
            setCompleteModal(null);
          }}
        >
          <article
            className="portal-admin-card"
            style={{ width: 'min(560px, 96vw)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Details of Goal Completion</h3>
            <label className="portal-inline-filter">
              Notes
              <textarea
                rows={5}
                value={completeModal.details}
                onChange={(event) =>
                  setCompleteModal((current) =>
                    current ? { ...current, details: event.target.value } : current
                  )
                }
                placeholder="Enter details..."
              />
            </label>
            <div className="portal-choice-line-actions">
              <button type="button" className="btn btn-primary" disabled={completingGoal} onClick={() => void saveGoalCompletion()}>
                {completingGoal ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={completingGoal} onClick={() => setCompleteModal(null)}>
                Cancel
              </button>
            </div>
          </article>
        </div>
      ) : null}

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
