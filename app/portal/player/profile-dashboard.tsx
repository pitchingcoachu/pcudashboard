'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import type {
  AssessmentWorkoutScoreRow,
  BodyWeightLogRow,
  PlayerPlanGoalRow,
  ProgramItemRow,
} from '../../../lib/training-db';
import WorkoutLogModal from '../components/workout-log-modal';
import PlayerNotesSuite from '../dashboard/player-notes-suite';
import ProfilePlanGoalsPanel from './profile-plan-goals-panel';
import { uploadPlayerMediaFile } from '../../../lib/upload-player-media';
import PlayerProLinkPanel from './player-pro-link-panel';
import PlayerMediaSection from './player-media-section';
import PlayerOwnNotes from './player-own-notes';

type TrackedExercise = {
  exerciseId: number;
  name: string;
  category: string;
};

type ExerciseTrendPoint = {
  dayDate: string;
  averageLoad: number;
};

type ForcePlateMetricOption = {
  key: string;
  label: string;
};

type TrendOption = {
  key: string;
  label: string;
};

type ForcePlateProfilePayload = {
  options?: ForcePlateMetricOption[];
  trendByMetric?: Record<string, ExerciseTrendPoint[]>;
  valdWeightLogs?: BodyWeightLogRow[];
  defaultMetricKey?: string;
  error?: string;
};

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
  schoolCode: string;
  sessionRole: 'admin' | 'coach' | 'player';
  sessionUserId: number | null;
  isAdminPreview: boolean;
  fullProgramHref: string;
  initialProfile: {
    fullName: string;
    email: string;
    status: string;
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
  trackedExercises: TrackedExercise[];
  initialExerciseId: number | null;
  initialTrend: ExerciseTrendPoint[];
};

const SHOW_ASSESSMENT_SCORES = false;

function isThrowingCalendarWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'throwing calendar' || normalized === 'throwing' || normalized.includes('throwing calendar');
}

function isBullpenWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'bullpen' || normalized === 'bullpens' || normalized.includes('bullpen');
}

function isVelocityWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'velocity plan' || normalized === 'velocity' || normalized.includes('velocity');
}

function isDrillsWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[‐‑‒–—−-]+/g, ' ').replace(/\s+/g, ' ');
  return normalized === 'drills'
    || normalized.includes('throwing drills')
    || normalized.includes('pre throw drills')
    || normalized.includes('mound drills');
}

function getCalendarLinkTarget(item: ProgramItemRow): 'none' | 'throwing' | 'bullpens' | 'velocity' | 'drills' {
  if (item.calendarLinkTarget && item.calendarLinkTarget !== 'none') return item.calendarLinkTarget;
  if (isThrowingCalendarWorkoutName(item.itemName)) return 'throwing';
  if (isBullpenWorkoutName(item.itemName)) return 'bullpens';
  if (isVelocityWorkoutName(item.itemName)) return 'velocity';
  if (isDrillsWorkoutName(item.itemName)) return 'drills';
  return 'none';
}

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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatScheduleHeading(dateIso: string, todayIso: string): string {
  if (dateIso === todayIso) return "Today's Schedule";
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'Schedule';
  return `${date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })} Schedule`;
}

const PROFILE_PLAN_SECTIONS: Array<{ key: 'daily_prep' | 'throwing' | 'post_throw_arm_care' | 's_and_c' | 'movement_mobility'; label: string }> = [
  { key: 'daily_prep', label: 'Daily Prep' },
  { key: 'throwing', label: 'Throwing' },
  { key: 'post_throw_arm_care', label: 'Post-Throw Arm Care' },
  { key: 's_and_c', label: 'S&C' },
  { key: 'movement_mobility', label: 'Movement and Mobility' },
];

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
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; label: string } | null>(null);
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
  return (
    <div className="portal-chart-wrap portal-profile-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="portal-chart portal-profile-line-chart" role="img" aria-label={yLabel}>
        {yTicks.map((tick) => (
          <g key={`y-${tick.value.toFixed(2)}`}>
            <line
              className="portal-profile-line-chart-grid"
              x1={leftPad}
              y1={tick.y}
              x2={width - rightPad}
              y2={tick.y}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
            <text className="portal-profile-line-chart-tick" x={leftPad - 8} y={tick.y + 4} textAnchor="end" fill="rgba(255,255,255,0.72)" fontSize="11">
              {Number.isInteger(tick.value) ? String(tick.value) : tick.value.toFixed(1)}
            </text>
          </g>
        ))}
        <line className="portal-profile-line-chart-axis" x1={leftPad} y1={topPad} x2={leftPad} y2={height - bottomPad} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <line className="portal-profile-line-chart-axis" x1={leftPad} y1={height - bottomPad} x2={width - rightPad} y2={height - bottomPad} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <path
          className="portal-profile-line-chart-path"
          d={path}
          fill="none"
          stroke="rgba(200, 16, 46, 0.95)"
          strokeWidth="2.6"
          style={{ fill: 'none' }}
        />
        {xTicks.map((point) => (
          <text
            className="portal-profile-line-chart-tick"
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
        {chartPoints.map((point, index) => (
          <circle
            className="portal-profile-line-chart-point"
            key={`${point.xLabel}-${point.value}-${index}`}
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
        <text className="portal-profile-line-chart-label" x={leftPad} y={12} fill="rgba(255,255,255,0.7)" fontSize="11">
          {yLabel}
        </text>
        {hoveredPoint && (
          <g className="portal-profile-line-chart-tooltip">
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
  schoolCode,
  sessionRole,
  sessionUserId,
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
  trackedExercises,
  initialExerciseId,
  initialTrend,
}: ProfileDashboardProps) {
  const router = useRouter();
  const showProfileDetailsPanel = sessionRole !== 'player';
  const programPreviewQuery = isAdminPreview ? `?previewPlayerId=${playerId}` : '';
  const [profile, setProfile] = useState({
    fullName: initialProfile.fullName,
    email: initialProfile.email,
    status: initialProfile.status || 'active',
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
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
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

  const todayDateIso = useMemo(() => todayIsoDate(), []);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(todayDateIso);
  const [scheduleItems, setScheduleItems] = useState<ProgramItemRow[]>(todayItems);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState('');
  const [scheduleWidgetView, setScheduleWidgetView] = useState<'day' | 'plan'>('plan');
  const [planItems, setPlanItems] = useState<ProgramItemRow[]>([]);
  const [planSectionNotes, setPlanSectionNotes] = useState<Record<string, string> | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planMessage, setPlanMessage] = useState('');
  const planLoadedRef = useRef(false);
  const [weightDate, setWeightDate] = useState(todayIsoDate());
  const [weightValue, setWeightValue] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [weightPhoto, setWeightPhoto] = useState<File | null>(null);
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightMessage, setWeightMessage] = useState('');
  const weightPhotoRequired = schoolCode.trim().toUpperCase() === 'UNOH';
  const [weightLogs, setWeightLogs] = useState<BodyWeightLogRow[]>(initialWeightLogs);
  const [trackedExerciseOptions, setTrackedExerciseOptions] = useState<TrackedExercise[]>(trackedExercises);

  const [selectedTrendKey, setSelectedTrendKey] = useState<string>(
    initialExerciseId ? `exercise:${initialExerciseId}` : ''
  );
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendMessage, setTrendMessage] = useState('');
  const [trendData, setTrendData] = useState<ExerciseTrendPoint[]>(initialTrend);
  const [forceMetricOptions, setForceMetricOptions] = useState<ForcePlateMetricOption[]>([]);
  const [forceTrendByMetric, setForceTrendByMetric] = useState<Record<string, ExerciseTrendPoint[]>>({});
  const [valdWeightLogs, setValdWeightLogs] = useState<BodyWeightLogRow[]>([]);
  const [defaultForceMetricKey, setDefaultForceMetricKey] = useState('');
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const [assessmentExpanded, setAssessmentExpanded] = useState(true);

  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);
  const [planGoals, setPlanGoals] = useState<GoalDraft[]>(
    [1, 2, 3].map((slot) => {
      const existing = initialPlanGoals.find((goal) => goal.slotIndex === slot);
      return {
        slotIndex: slot as 1 | 2 | 3,
        category: existing?.category === 'Command' ? 'Execution' : (existing?.category ?? ''),
        goalDescription: existing?.goalDescription ?? '',
        createdAt: existing?.createdAt ?? null,
      };
    })
  );
  const [selectedAssessmentDate, setSelectedAssessmentDate] = useState(
    initialAssessmentScores[0]?.dayDate ?? ''
  );
  const [playerNotesExpanded, setPlayerNotesExpanded] = useState(false);
  const normalizedPlayerStatus = String(profile.status ?? '').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
  const playerStatusLabel = normalizedPlayerStatus === 'inactive' ? 'Inactive' : 'Active';
  const playerStatusBadgeStyle: CSSProperties = {
    border: `1px solid ${normalizedPlayerStatus === 'inactive' ? 'rgba(255, 95, 95, 0.45)' : 'rgba(64, 211, 120, 0.45)'}`,
    background: normalizedPlayerStatus === 'inactive' ? 'rgba(255, 95, 95, 0.12)' : 'rgba(64, 211, 120, 0.12)',
    color: normalizedPlayerStatus === 'inactive' ? '#ff8b8b' : '#6fe58e',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0,
    lineHeight: 1,
    padding: '7px 10px',
    textTransform: 'uppercase',
  };

  useEffect(() => {
    router.prefetch(fullProgramHref);
  }, [fullProgramHref, router]);

  const loadScheduleItems = useCallback(
    async (signal?: AbortSignal) => {
      setScheduleLoading(true);
      setScheduleMessage('');
      const endDate = addDays(selectedScheduleDate, 1);
      try {
        const response = await fetch(`/api/player/program-items?playerId=${playerId}&startDate=${selectedScheduleDate}&endDate=${endDate}`, {
          cache: 'no-store',
          signal,
        });
        const payload = (await response.json().catch(() => ({}))) as { items?: ProgramItemRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load schedule.');
        setScheduleItems(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        if (signal?.aborted) return;
        setScheduleItems([]);
        setScheduleMessage(error instanceof Error ? error.message : 'Failed to load schedule.');
      } finally {
        if (!signal?.aborted) setScheduleLoading(false);
      }
    },
    [playerId, selectedScheduleDate]
  );

  useEffect(() => {
    if (selectedScheduleDate === todayDateIso) {
      setScheduleItems(todayItems);
      setScheduleMessage('');
      setScheduleLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadScheduleItems(controller.signal);
    return () => controller.abort();
  }, [selectedScheduleDate, todayDateIso, todayItems, loadScheduleItems]);

  const loadPlanItems = useCallback(
    async (signal?: AbortSignal) => {
      setPlanLoading(true);
      setPlanMessage('');
      try {
        const response = await fetch(`/api/player/plan-items?playerId=${playerId}`, { cache: 'no-store', signal });
        const payload = (await response.json().catch(() => ({}))) as {
          items?: ProgramItemRow[];
          sectionNotes?: Record<string, string>;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load Training Program.');
        setPlanItems(Array.isArray(payload.items) ? payload.items : []);
        setPlanSectionNotes(payload.sectionNotes ?? null);
      } catch (error) {
        if (signal?.aborted) return;
        planLoadedRef.current = false;
        setPlanItems([]);
        setPlanMessage(error instanceof Error ? error.message : 'Failed to load Training Program.');
      } finally {
        if (!signal?.aborted) setPlanLoading(false);
      }
    },
    [playerId]
  );

  useEffect(() => {
    if (scheduleWidgetView !== 'plan' || planLoadedRef.current) return;
    planLoadedRef.current = true;
    const controller = new AbortController();
    void loadPlanItems(controller.signal);
    return () => controller.abort();
  }, [scheduleWidgetView, loadPlanItems]);

  const sortedWeightLogs = useMemo(() => {
    const merged = new Map<string, BodyWeightLogRow>();
    for (const log of [...weightLogs, ...valdWeightLogs]) {
      const key = String(log.logDate ?? '').trim();
      if (!key || !Number.isFinite(Number(log.weightLbs))) continue;
      const current = merged.get(key);
      if (!current || Number(log.weightLbs) > Number(current.weightLbs)) {
        merged.set(key, {
          id: log.id,
          logDate: key,
          weightLbs: Number(log.weightLbs),
          notes: log.notes ?? null,
          mediaId: log.mediaId ?? null,
        });
      }
    }
    return Array.from(merged.values()).sort((a, b) => a.logDate.localeCompare(b.logDate));
  }, [weightLogs, valdWeightLogs]);
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

  const trendOptions = useMemo<TrendOption[]>(
    () => [
      ...trackedExerciseOptions.map((exercise) => ({
        key: `exercise:${exercise.exerciseId}`,
        label: `${exercise.name} (${exercise.category})`,
      })),
      ...forceMetricOptions.map((metric) => ({
        key: `force:${metric.key}`,
        label: metric.label,
      })),
    ],
    [trackedExerciseOptions, forceMetricOptions]
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
    let cancelled = false;
    const loadForceMetrics = async () => {
      try {
        const params = new URLSearchParams({ playerId: String(playerId) });
        const response = await fetch(`/api/player/force-plate-profile?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as ForcePlateProfilePayload;
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load force plate profile metrics.');
        if (cancelled) return;
        const options = Array.isArray(payload.options) ? payload.options : [];
        setForceMetricOptions(options);
        setForceTrendByMetric(payload.trendByMetric ?? {});
        setValdWeightLogs(Array.isArray(payload.valdWeightLogs) ? payload.valdWeightLogs : []);
        setDefaultForceMetricKey(String(payload.defaultMetricKey ?? ''));
      } catch {
        if (cancelled) return;
        setForceMetricOptions([]);
        setForceTrendByMetric({});
        setValdWeightLogs([]);
        setDefaultForceMetricKey('');
      }
    };

    void loadForceMetrics();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    if (!trendOptions.length) {
      setSelectedTrendKey('');
      return;
    }
    if (selectedTrendKey && trendOptions.some((option) => option.key === selectedTrendKey)) return;
    if (defaultForceMetricKey && trendOptions.some((option) => option.key === `force:${defaultForceMetricKey}`)) {
      setSelectedTrendKey(`force:${defaultForceMetricKey}`);
      return;
    }
    setSelectedTrendKey(trendOptions[0]?.key ?? '');
  }, [trendOptions, selectedTrendKey, defaultForceMetricKey]);

  useEffect(() => {
    if (!selectedTrendKey) {
      setTrendData([]);
      return;
    }
    if (selectedTrendKey.startsWith('force:')) {
      const metricKey = selectedTrendKey.slice('force:'.length);
      setTrendLoading(false);
      setTrendMessage('');
      setTrendData(Array.isArray(forceTrendByMetric[metricKey]) ? forceTrendByMetric[metricKey] : []);
      return;
    }
    const selectedExerciseId = Number(selectedTrendKey.slice('exercise:'.length));
    if (!Number.isFinite(selectedExerciseId) || selectedExerciseId <= 0) {
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
  }, [playerId, selectedTrendKey, forceTrendByMetric]);

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

  const savePlayerStatus = async (nextStatus: 'active' | 'inactive') => {
    setStatusSaving(true);
    setStatusMessage('');
    try {
      const response = await fetch('/api/player/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, status: nextStatus }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update player status.');
      setProfile((prev) => ({ ...prev, status: payload.status === 'inactive' ? 'inactive' : 'active' }));
      setStatusMessage(nextStatus === 'inactive' ? 'Player deactivated.' : 'Player reactivated.');
      router.refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to update player status.');
    } finally {
      setStatusSaving(false);
    }
  };

  const onPhotoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoMessage('Please choose an image file.');
      event.target.value = '';
      return;
    }
    if (file.size > 20_000_000) {
      setPhotoMessage('Image is too large. Please keep it under 20MB.');
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
      ? `${heightValue} ${roundedWeight} lbs`
      : heightValue || (roundedWeight !== null ? `${roundedWeight} lbs` : '');
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
            {showProfileDetailsPanel ? <span style={playerStatusBadgeStyle}>{playerStatusLabel}</span> : null}
          </div>
          {heroGradPositionLine ? <p className="portal-profile-hero-line">{heroGradPositionLine}</p> : null}
          {heroHeightWeightLine ? <p className="portal-profile-hero-line">{heroHeightWeightLine}</p> : null}
          {heroCommitLine ? <p className="portal-profile-hero-line">{heroCommitLine}</p> : null}
        </div>
        {photoMessage ? <p className={photoMessage === 'Profile photo updated.' ? 'auth-message' : 'auth-error'}>{photoMessage}</p> : null}
      </section>

      <article className="portal-admin-card">
        <div className="portal-row-between" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Videos, Photos & PDFs</h3>
          <button type="button" className="btn btn-ghost" onClick={() => setMediaExpanded((v) => !v)}>
            {mediaExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {mediaExpanded ? <PlayerMediaSection playerId={playerId} isPlayer={sessionRole === 'player'} /> : null}
      </article>

      {showProfileDetailsPanel && (
        <article className="portal-admin-card">
        <div className="portal-row-between">
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h3>Profile Details</h3>
            <span style={playerStatusBadgeStyle}>{playerStatusLabel}</span>
          </div>
          <div className="portal-choice-line-actions">
            {canEditProfile ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={statusSaving}
                onClick={() => savePlayerStatus(normalizedPlayerStatus === 'inactive' ? 'active' : 'inactive')}
              >
                {statusSaving ? 'Saving...' : normalizedPlayerStatus === 'inactive' ? 'Reactivate' : 'Deactivate'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setProfileExpanded((current) => !current)}
              aria-expanded={profileExpanded}
            >
              {profileExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        {statusMessage ? (
          <p className={statusMessage.startsWith('Player ') ? 'auth-message' : 'auth-error'}>{statusMessage}</p>
        ) : null}
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

      <PlayerProLinkPanel
        playerId={playerId}
        playerName={profile.fullName}
        canEdit={sessionRole === 'admin' || sessionRole === 'coach'}
      />

      {sessionRole === 'admin' || sessionRole === 'coach' ? (
        <article className="portal-admin-card">
          <div className="portal-row-between">
            <h3>Player Notes</h3>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPlayerNotesExpanded((current) => !current)}
              aria-expanded={playerNotesExpanded}
            >
              {playerNotesExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {playerNotesExpanded ? (
            <PlayerNotesSuite
              fixedPlayer={{
                playerId,
                fullName: profile.fullName,
              }}
              embedded
            />
          ) : null}
        </article>
      ) : (
        <PlayerOwnNotes playerId={playerId} currentUserId={sessionUserId} />
      )}

      <ProfilePlanGoalsPanel
        playerId={playerId}
        playerName={profile.fullName}
        goals={planGoals}
        canEditGoals={sessionRole === 'admin' || sessionRole === 'coach'}
      />

      {SHOW_ASSESSMENT_SCORES ? (
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
      ) : null}

      <div className="portal-profile-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.85rem' }}>
        <article className="portal-admin-card">
          <div className="portal-row-between portal-profile-schedule-head">
            <div className="portal-profile-schedule-title-row">
              {scheduleWidgetView === 'day' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost portal-profile-schedule-arrow"
                    aria-label="Show previous day's schedule"
                    onClick={() => setSelectedScheduleDate((current) => addDays(current, -1))}
                  >
                    &lt;
                  </button>
                  <h3>{formatScheduleHeading(selectedScheduleDate, todayDateIso)}</h3>
                  <button
                    type="button"
                    className="btn btn-ghost portal-profile-schedule-arrow"
                    aria-label="Show next day's schedule"
                    onClick={() => setSelectedScheduleDate((current) => addDays(current, 1))}
                  >
                    &gt;
                  </button>
                </>
              ) : (
                <h3>Training Program</h3>
              )}
            </div>
            <div className="portal-choice-line-actions">
              <div className="portal-schedule-view-switch" role="group" aria-label="Schedule widget view">
                <button
                  type="button"
                  className={`btn ${scheduleWidgetView === 'day' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setScheduleWidgetView('day')}
                >
                  Day
                </button>
                <button
                  type="button"
                  className={`btn ${scheduleWidgetView === 'plan' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setScheduleWidgetView('plan')}
                >
                  Training Program
                </button>
              </div>
              {scheduleWidgetView === 'day' && selectedScheduleDate !== todayDateIso ? (
                <button type="button" className="btn btn-ghost" onClick={() => setSelectedScheduleDate(todayDateIso)}>
                  Today
                </button>
              ) : null}
              <Link className="btn btn-ghost as-link" href={fullProgramHref}>
                Click for Full Program
              </Link>
            </div>
          </div>
          {scheduleWidgetView === 'day' ? (
            scheduleLoading ? (
              <p className="portal-muted-text">Loading schedule...</p>
            ) : scheduleMessage ? (
              <p className="auth-error">{scheduleMessage}</p>
            ) : scheduleItems.length === 0 ? (
              <p className="portal-muted-text">No workouts assigned for {selectedScheduleDate === todayDateIso ? 'today' : formatDate(selectedScheduleDate)}.</p>
            ) : (
              <div className="portal-player-items">
                {scheduleItems.map((item) => (
                  <button
                    key={item.itemId}
                    type="button"
                    className="portal-schedule-item"
                    title={item.itemName}
                    style={categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout')}
                    onClick={() => {
                      const linkTarget = getCalendarLinkTarget(item);
                      if (linkTarget === 'throwing') {
                        const sep = programPreviewQuery ? '&' : '?';
                        router.push(`/portal/player/program/throwing${programPreviewQuery}${sep}date=${item.dayDate}`);
                        return;
                      }
                      if (linkTarget === 'bullpens') {
                        router.push(`/portal/player/program/bullpens${programPreviewQuery}`);
                        return;
                      }
                      if (linkTarget === 'velocity') {
                        router.push(`/portal/player/program/velocity${programPreviewQuery}`);
                        return;
                      }
                      if (linkTarget === 'drills') {
                        router.push(`/portal/player/program/drills${programPreviewQuery}`);
                        return;
                      }
                      setSelectedItem(item);
                    }}
                  >
                    <strong>{item.itemName}</strong>
                  </button>
                ))}
              </div>
            )
          ) : planLoading ? (
            <p className="portal-muted-text">Loading Training Program...</p>
          ) : planMessage ? (
            <p className="auth-error">{planMessage}</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {PROFILE_PLAN_SECTIONS.map((section) => {
                const sectionItems = planItems.filter((item) => item.scheduleType === 'plan' && item.planSection === section.key);
                const note = planSectionNotes?.[section.key]?.trim() ?? '';
                return (
                  <div key={section.key}>
                    <div className="portal-row-between" style={{ marginBottom: '0.3rem' }}>
                      <strong style={{ fontSize: '0.88rem' }}>{section.label}</strong>
                    </div>
                    {note ? (
                      <p className="portal-muted-text" style={{ margin: '0 0 0.35rem', whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>
                        {note}
                      </p>
                    ) : null}
                    {sectionItems.length === 0 ? (
                      <p className="portal-muted-text" style={{ margin: 0, fontSize: '0.85rem' }}>No workouts assigned</p>
                    ) : (
                      <div className="portal-player-items">
                        {sectionItems.map((item) => (
                          <button
                            key={item.itemId}
                            type="button"
                            className="portal-schedule-item"
                            title={item.itemName}
                            style={{ ...categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout'), display: 'grid', gap: 2 }}
                            onClick={() => {
                              const linkTarget = getCalendarLinkTarget(item);
                              if (linkTarget === 'throwing') {
                                const sep = programPreviewQuery ? '&' : '?';
                                router.push(`/portal/player/program/throwing${programPreviewQuery}${sep}date=${item.dayDate}`);
                                return;
                              }
                              if (linkTarget === 'bullpens') {
                                router.push(`/portal/player/program/bullpens${programPreviewQuery}`);
                                return;
                              }
                              if (linkTarget === 'velocity') {
                                router.push(`/portal/player/program/velocity${programPreviewQuery}`);
                                return;
                              }
                              if (linkTarget === 'drills') {
                                router.push(`/portal/player/program/drills${programPreviewQuery}`);
                                return;
                              }
                              setSelectedItem(item);
                            }}
                          >
                            <strong>{item.itemName}</strong>
                            {item.completedCount !== null ? (
                              <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>
                                Completed {item.completedCount ?? 0}
                                {item.targetCount ? `/${item.targetCount}` : ''} time{(item.completedCount ?? 0) === 1 && !item.targetCount ? '' : 's'}
                              </span>
                            ) : null}
                            {item.planItemAddedAt ? (
                              <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>Added {formatTimestampDate(item.planItemAddedAt)}</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="portal-admin-card">
          <h3>Exercise Load Trend</h3>
          <select
            className="portal-assessment-trend-select"
            aria-label="Exercise or force plate metric"
            value={selectedTrendKey}
            onChange={(event) => setSelectedTrendKey(event.target.value)}
          >
            <option value="">Select metric</option>
            {trendOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
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
              if (weightPhotoRequired && !weightPhoto) {
                setWeightMessage('A photo of the scale is required for weight entries.');
                return;
              }
              setWeightSaving(true);
              setWeightMessage('');
              try {
                let mediaId: number | null = null;
                if (weightPhoto) {
                  const uploadResult = await uploadPlayerMediaFile({
                    playerId,
                    file: weightPhoto,
                    title: `Weight log ${weightDate}`,
                    category: 'Weight Log',
                    sourceType: 'weight_log',
                  });
                  if (!uploadResult.ok) throw new Error(uploadResult.error);
                  const created = uploadResult.createdMedia as { id?: number } | undefined;
                  mediaId = typeof created?.id === 'number' ? created.id : null;
                  if (weightPhotoRequired && !mediaId) throw new Error('Photo upload did not complete. Please try again.');
                }
                const response = await fetch('/api/player/weight-logs', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    playerId,
                    logDate: weightDate,
                    weightLbs: Number(weightValue),
                    notes: weightNotes,
                    mediaId,
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
                setWeightPhoto(null);
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
            <label className="portal-form-span-2">
              {weightPhotoRequired ? 'Photo of scale (required)' : 'Photo of scale (optional)'}
              <input
                type="file"
                accept="image/*"
                required={weightPhotoRequired}
                onChange={(event) => setWeightPhoto(event.target.files?.[0] ?? null)}
              />
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

      {selectedItem && (
        <WorkoutLogModal
          item={selectedItem}
          playerId={playerId}
          onClose={() => setSelectedItem(null)}
          onSaved={async () => {
            if (selectedItem.scheduleType === 'plan') {
              await loadPlanItems();
            } else {
              await loadScheduleItems();
            }
          }}
        />
      )}
    </div>
  );
}
