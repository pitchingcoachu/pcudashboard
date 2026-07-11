'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ProgramItemRow } from '../../../../lib/training-db';
import {
  DEFAULT_DRILL_ROW_COUNT,
  emptyDrillRow,
  normalizeDrillRows,
  normalizeDrillsState,
  normalizeDrillTemplates,
  type DrillRow,
  type DrillTemplate,
  type DrillsState,
} from '../../../../lib/drills-program';
import WorkoutLogModal from '../../components/workout-log-modal';
import BullpenEntry from '../../player/program/bullpens/bullpen-entry';

type PlayerChoice = { id: number; name: string };
type CalendarLinkTarget = 'none' | 'throwing' | 'bullpens' | 'velocity' | 'drills';
type WorkoutChoice = { id: number; name: string; exerciseCount: number; category: string; calendarLinkTarget: CalendarLinkTarget };
type ViewMode = 'day' | 'week' | 'month' | 'cycle' | 'throwing' | 'bullpens' | 'velocity' | 'drills';
type ThrowingBuilderMode = 'month' | 'weeks';
type ThrowingCalendarView = 'day' | 'week' | 'month';
type BuilderMode = 'schedule' | 'template';
type PaletteMode = 'workouts' | 'templates';
type WorkoutPaletteView = 'all' | 'categories';
type ThrowingDayEntry = { intensity: string; distance: string; throwsText: string; drills: string; bullpen: string };
type ThrowingTemplate = {
  id: string;
  name: string;
  weekCount: number;
  byCell: Record<string, ThrowingDayEntry>;
  weekNotes: Record<string, string>;
  updatedAt: string;
};
type BullpenScript = {
  title: string;
  rowCount: number;
  columns: string[];
  columnTypes?: BullpenColumnType[];
  rows: string[][];
};
const BULLPEN_CATEGORIES = ['Velocity', 'Command', 'Pitch Design', 'Combo', 'Mechanical', 'Build Ups'] as const;
type BullpenCategory = (typeof BULLPEN_CATEGORIES)[number] | '';

type BullpenTemplate = {
  id: string;
  name: string;
  category?: BullpenCategory;
  rowCount: number;
  columns: string[];
  columnTypes?: BullpenColumnType[];
  rows: string[][];
  updatedAt: string;
};
type BullpenState = {
  current: BullpenScript;
  selectedTemplateId: string;
  visibleTemplateIds?: string[];
  templates?: BullpenTemplate[];
  notes?: string;
};
type BullpenFieldKey = number;
type BullpenColumnType = 'auto' | 'text' | 'fill' | 'velocity' | 'strike' | 'two-thirds';
type TemplateChoice = {
  id: number;
  name: string;
  totalDays: number;
  workoutCount: number;
  updatedAt: string;
  days: Array<{
    id: number;
    dayOffset: number;
    items: Array<{
      id: number;
      workoutId: number;
      workoutName: string;
      workoutCategory: string | null;
      sortOrder: number;
      prescribedSets: string | null;
      prescribedReps: string | null;
      prescribedLoad: string | null;
      prescribedNotes: string | null;
    }>;
  }>;
};
type TemplateDraftItem = {
  workoutId: number;
  workoutName: string;
  workoutCategory: string | null;
  prescribedSets?: string;
  prescribedReps?: string;
  prescribedLoad?: string;
  prescribedNotes?: string;
};

type ScheduleBoardProps = {
  players: PlayerChoice[];
  workouts: WorkoutChoice[];
  exercises: Array<{ id: number; name: string; category: string; instructionVideoUrl: string | null }>;
  schoolCode: string;
  schoolLogoSrc: string | null;
  schoolLogoAlt: string;
  initialPlayerId?: number;
};

type CopiedAssignment = {
  assignmentType: 'exercise' | 'workout';
  exerciseId?: number;
  workoutId?: number;
  prescribedSets?: string;
  prescribedReps?: string;
  prescribedLoad?: string;
  prescribedNotes?: string;
};

type CopiedPlanBuffer = {
  mode: 'day' | 'week';
  sourceDate: string;
  days: Array<{ offset: number; items: CopiedAssignment[] }>;
};

type CycleSlotKey = 'medium' | 'high' | 'low' | 'mobility' | 's_and_c';

type CopiedCycleBuffer = {
  sourceSlot: CycleSlotKey;
  items: Array<{ workoutId: number }>;
};

type ThrowingCopiedBuffer = {
  mode: 'day' | 'week';
  days: Array<{ offset: number; entry: ThrowingDayEntry }>;
  weekNote?: string;
};

type ThrowingMenuState =
  | { mode: 'month'; date: string; x: number; y: number }
  | { mode: 'weeks'; weekIndex: number; dayIndex: number; x: number; y: number };

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TEMPLATE_MIN_WEEKS = 1;
const TEMPLATE_MAX_WEEKS = 52;
const THROWING_MIN_WEEKS = 1;
const THROWING_MAX_WEEKS = 24;
const BULLPEN_MIN_ROWS = 1;
const BULLPEN_MAX_ROWS = 300;
const CYCLE_COLUMNS: Array<{ key: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c'; label: string }> = [
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'low', label: 'Low' },
  { key: 'mobility', label: 'Mobility' },
  { key: 's_and_c', label: 'S&C' },
];
const SCHEDULE_REQUEST_TIMEOUT_MS = 20000;

const DEFAULT_BULLPEN_COLUMNS = ['Pitch Type', 'Ball Type', 'Stretch/Windup', 'Location', 'Situation', 'Notes'];
const DEFAULT_BULLPEN_COLUMN_TYPE: BullpenColumnType = 'auto';
const BULLPEN_COLUMN_TYPE_OPTIONS: Array<{ value: BullpenColumnType; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'text', label: 'Text' },
  { value: 'fill', label: 'Fill-In' },
  { value: 'velocity', label: 'Velocity' },
  { value: 'strike', label: 'Strike/Ball' },
  { value: 'two-thirds', label: '2/3' },
];

function normalizeBullpenColumnTypes(raw: unknown, columnCount: number): BullpenColumnType[] {
  const allowed = new Set<BullpenColumnType>(BULLPEN_COLUMN_TYPE_OPTIONS.map((option) => option.value));
  const source = Array.isArray(raw) ? raw : [];
  const values = source.slice(0, columnCount).map((value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'yes-no') return 'strike';
    return allowed.has(normalized as BullpenColumnType) ? normalized as BullpenColumnType : DEFAULT_BULLPEN_COLUMN_TYPE;
  });
  while (values.length < columnCount) values.push(DEFAULT_BULLPEN_COLUMN_TYPE);
  return values;
}

function buildBullpenRows(rowCount: number, columnCount: number, rows?: string[][]): string[][] {
  const normalizedCount = Math.max(BULLPEN_MIN_ROWS, Math.min(BULLPEN_MAX_ROWS, rowCount || 20));
  const safeCols = Math.max(1, Math.min(16, columnCount || DEFAULT_BULLPEN_COLUMNS.length));
  const base = Array.isArray(rows)
    ? rows.slice(0, normalizedCount).map((row) => {
        const values = Array.isArray(row) ? row.slice(0, safeCols).map((v) => String(v ?? '')) : [];
        while (values.length < safeCols) values.push('');
        return values;
      })
    : [];
  while (base.length < normalizedCount) base.push(Array.from({ length: safeCols }, () => ''));
  return base;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = SCHEDULE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const mergedInit: RequestInit = { ...init, signal: controller.signal };
    return await fetch(input, mergedInit);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, days: number): string {
  const date = fromIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function startOfWeek(value: string): string {
  const date = fromIsoDate(value);
  const offset = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - offset);
  return toIsoDate(date);
}

function endOfWeekExclusive(value: string): string {
  return addDays(startOfWeek(value), 7);
}

function startOfMonth(value: string): string {
  const date = fromIsoDate(value);
  date.setUTCDate(1);
  return toIsoDate(date);
}

function endOfMonthExclusive(value: string): string {
  const date = fromIsoDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return toIsoDate(date);
}

function makeMonthGrid(anchor: string): string[] {
  const first = startOfMonth(anchor);
  const firstDate = fromIsoDate(first);
  const lastDate = fromIsoDate(endOfMonthExclusive(anchor));
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);

  const leading = firstDate.getUTCDay();
  const daysInMonth = lastDate.getUTCDate();
  const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;

  const result: string[] = [];
  for (let i = leading; i > 0; i -= 1) {
    result.push(addDays(first, -i));
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = fromIsoDate(first);
    date.setUTCDate(day);
    result.push(toIsoDate(date));
  }
  const monthEnd = toIsoDate(lastDate);
  for (let i = 1; i <= trailing; i += 1) result.push(addDays(monthEnd, i));
  return result;
}

function dateTitle(value: string): string {
  return fromIsoDate(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayNumber(value: string): string {
  return String(fromIsoDate(value).getUTCDate());
}

function shortDayLabel(value: string): string {
  return WEEKDAY_SHORT_LABELS[fromIsoDate(value).getUTCDay()];
}

function isToday(value: string): boolean {
  return value === toIsoDate(new Date());
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function categoryBubbleStyle(category: string): CSSProperties {
  const hue = hashString(category) % 360;
  return {
    borderColor: `hsla(${hue}, 88%, 64%, 0.7)`,
    background: `hsla(${hue}, 82%, 52%, 0.2)`,
  };
}

function isThrowingCalendarWorkoutName(value: string): boolean {
  return value.trim().toLowerCase() === 'throwing calendar';
}

function isBullpenWorkoutName(value: string): boolean {
  return value.trim().toLowerCase() === 'bullpen';
}

function isVelocityWorkoutName(value: string): boolean {
  return value.trim().toLowerCase() === 'velocity plan';
}
function isDrillsWorkoutName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[‐‑‒–—−-]+/g, ' ').replace(/\s+/g, ' ');
  return normalized === 'drills'
    || normalized.includes('throwing drills')
    || normalized.includes('pre throw drills')
    || normalized.includes('mound drills');
}

function getCalendarLinkTarget(item: ProgramItemRow): CalendarLinkTarget {
  if (item.calendarLinkTarget && item.calendarLinkTarget !== 'none') return item.calendarLinkTarget;
  if (isThrowingCalendarWorkoutName(item.itemName)) return 'throwing';
  if (isBullpenWorkoutName(item.itemName)) return 'bullpens';
  if (isVelocityWorkoutName(item.itemName)) return 'velocity';
  if (isDrillsWorkoutName(item.itemName)) return 'drills';
  return 'none';
}

function isDrillEligibleCategory(category: string): boolean {
  const value = String(category ?? '').trim().toLowerCase();
  return value.includes('plyo') || value.includes('throw') || (value.includes('medicine') && value.includes('ball'));
}

export default function ScheduleBoard({ players, workouts, exercises, schoolCode, schoolLogoSrc, schoolLogoAlt, initialPlayerId }: ScheduleBoardProps) {
  const resolveInitialPlayer = () => {
    if (initialPlayerId && players.some((player) => player.id === initialPlayerId)) {
      const matched = players.find((player) => player.id === initialPlayerId)!;
      return { id: matched.id, name: matched.name };
    }
    return { id: 0, name: '' };
  };
  const initialPlayer = resolveInitialPlayer();
  const [playerId, setPlayerId] = useState<number>(initialPlayer.id);
  const [playerQuery, setPlayerQuery] = useState(initialPlayer.name);
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [playerPickerShowAll, setPlayerPickerShowAll] = useState(false);
  const playerPickerRef = useRef<HTMLDivElement | null>(null);
  const [isMobileSchedule, setIsMobileSchedule] = useState(false);
  const [view, setView] = useState<ViewMode>('month');
  const [mobilePaletteCollapsed, setMobilePaletteCollapsed] = useState(true);
  const [builderMode, setBuilderMode] = useState<BuilderMode>('schedule');
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('workouts');
  const [workoutPaletteView, setWorkoutPaletteView] = useState<WorkoutPaletteView>('categories');
  const [selectedWorkoutCategory, setSelectedWorkoutCategory] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<string>(toIsoDate(new Date()));
  const [workoutQuery, setWorkoutQuery] = useState('');
  const [templates, setTemplates] = useState<TemplateChoice[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateWeekCount, setTemplateWeekCount] = useState(4);
  const [templateDayItems, setTemplateDayItems] = useState<Record<number, TemplateDraftItem[]>>({});
  const [items, setItems] = useState<ProgramItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<ProgramItemRow | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [bulkReplaceOpen, setBulkReplaceOpen] = useState(false);
  const [bulkReplaceQuery, setBulkReplaceQuery] = useState('');
  const [copiedPlan, setCopiedPlan] = useState<CopiedPlanBuffer | null>(null);
  const [copiedCycle, setCopiedCycle] = useState<CopiedCycleBuffer | null>(null);
  const [copiedThrowing, setCopiedThrowing] = useState<ThrowingCopiedBuffer | null>(null);
  const [menu, setMenu] = useState<{ dayDate: string; x: number; y: number } | null>(null);
  const [cycleMenu, setCycleMenu] = useState<{ cycleSlot: CycleSlotKey; x: number; y: number } | null>(null);
  const [throwingMenu, setThrowingMenu] = useState<ThrowingMenuState | null>(null);
  const [throwingByDate, setThrowingByDate] = useState<Record<string, ThrowingDayEntry>>({});
  const [throwingWeekNotes, setThrowingWeekNotes] = useState<Record<string, string>>({});
  const [throwingBuilderMode, setThrowingBuilderMode] = useState<ThrowingBuilderMode>('month');
  const [throwingCalendarView, setThrowingCalendarView] = useState<ThrowingCalendarView>('month');
  const [throwingTemplates, setThrowingTemplates] = useState<ThrowingTemplate[]>([]);
  const [selectedThrowingTemplateId, setSelectedThrowingTemplateId] = useState<string>('');
  const [throwingTemplateName, setThrowingTemplateName] = useState('');
  const [throwingTemplateWeekCount, setThrowingTemplateWeekCount] = useState(4);
  const [throwingTemplateByCell, setThrowingTemplateByCell] = useState<Record<string, ThrowingDayEntry>>({});
  const [throwingTemplateWeekNotes, setThrowingTemplateWeekNotes] = useState<Record<string, string>>({});
  const [throwingApplyTemplateId, setThrowingApplyTemplateId] = useState<string>('');
  const [throwingApplyStartDate, setThrowingApplyStartDate] = useState<string>('');
  const [bullpenCurrent, setBullpenCurrent] = useState<BullpenScript>({
    title: '',
    rowCount: 20,
    columns: [...DEFAULT_BULLPEN_COLUMNS],
    rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length),
  });
  const [bullpenTemplates, setBullpenTemplates] = useState<BullpenTemplate[]>([]);
  const [selectedBullpenTemplateId, setSelectedBullpenTemplateId] = useState<string>('');
  const [visibleBullpenTemplateIds, setVisibleBullpenTemplateIds] = useState<string[]>([]);
  const [bullpenNotes, setBullpenNotes] = useState('');
  const [bullpenCurrentCategory, setBullpenCurrentCategory] = useState<BullpenCategory>('');
  const [velocityCurrent, setVelocityCurrent] = useState<BullpenScript>({
    title: '',
    rowCount: 20,
    columns: [...DEFAULT_BULLPEN_COLUMNS],
    rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length),
  });
  const [velocityTemplates, setVelocityTemplates] = useState<BullpenTemplate[]>([]);
  const [selectedVelocityTemplateId, setSelectedVelocityTemplateId] = useState<string>('');
  const [visibleVelocityTemplateIds, setVisibleVelocityTemplateIds] = useState<string[]>([]);
  const [velocityNotes, setVelocityNotes] = useState('');
  const [drillsNotes, setDrillsNotes] = useState('');
  const [drillsRowCount, setDrillsRowCount] = useState<number>(4);
  const [drillsRows, setDrillsRows] = useState<DrillRow[]>(() => normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
  const [postDrillsRowCount, setPostDrillsRowCount] = useState<number>(DEFAULT_DRILL_ROW_COUNT);
  const [postDrillsRows, setPostDrillsRows] = useState<DrillRow[]>(() => normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
  const [selectedPreDrillTemplateId, setSelectedPreDrillTemplateId] = useState('');
  const [selectedPostDrillTemplateId, setSelectedPostDrillTemplateId] = useState('');
  const [preDrillTemplateName, setPreDrillTemplateName] = useState('');
  const [postDrillTemplateName, setPostDrillTemplateName] = useState('');
  const [preThrowDrillTemplates, setPreThrowDrillTemplates] = useState<DrillTemplate[]>([]);
  const [postThrowDrillTemplates, setPostThrowDrillTemplates] = useState<DrillTemplate[]>([]);
  const [drillExerciseOptions, setDrillExerciseOptions] = useState<Array<{ id: number; name: string; category: string; instructionVideoUrl: string | null }>>(
    exercises.filter((exercise) => isDrillEligibleCategory(exercise.category))
  );
  const [newDrillName, setNewDrillName] = useState('');
  const [newDrillCategory, setNewDrillCategory] = useState('Plyos');
  const [newDrillVideoUrl, setNewDrillVideoUrl] = useState('');
  const [newDrillSaveToLibrary, setNewDrillSaveToLibrary] = useState(true);
  const [drillVideoPreview, setDrillVideoPreview] = useState<{ title: string; url: string } | null>(null);
  const drillsNoteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [catchPlayHighDay, setCatchPlayHighDay] = useState('');
  const [catchPlayMediumDay, setCatchPlayMediumDay] = useState('');
  const [catchPlayLowDay, setCatchPlayLowDay] = useState('');
  const [cycleNotes, setCycleNotes] = useState('');

  useEffect(() => {
    if (!players.length) return;
    if (playerId === 0) return; // Intentionally no player selected
    if (players.some((player) => player.id === playerId)) return;
    const next = initialPlayerId && players.some((player) => player.id === initialPlayerId)
      ? players.find((player) => player.id === initialPlayerId) ?? players[0]
      : players[0];
    if (!next) return;
    setPlayerId(next.id);
    setPlayerQuery(next.name);
  }, [players, playerId, initialPlayerId]);
  const [bullpenFillDrag, setBullpenFillDrag] = useState<{ sourceRow: number; sourceField: BullpenFieldKey; value: string } | null>(null);
  const [bullpenColumnDragIndex, setBullpenColumnDragIndex] = useState<number | null>(null);
  const [scriptTemplateBuilderCollapsed, setScriptTemplateBuilderCollapsed] = useState(true);
  const [scriptVisibilityMenuOpen, setScriptVisibilityMenuOpen] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(BULLPEN_CATEGORIES));
  const bullpenFillTargetsRef = useRef<Set<string>>(new Set());
  const throwingCalendarRef = useRef<HTMLDivElement | null>(null);
  const throwingStateLoadedRef = useRef(false);

  const resetTemplateDraft = () => {
    setSelectedTemplateId(null);
    setTemplateName('');
    setTemplateWeekCount(4);
    setTemplateDayItems({});
  };

  const filteredPlayers = useMemo(() => {
    if (playerPickerShowAll) return [...players].sort((a, b) => a.name.localeCompare(b.name));
    const q = playerQuery.trim().toLowerCase();
    const matches = q
      ? players.filter((player) => player.name.toLowerCase().includes(q))
      : players;
    return [...matches].sort((a, b) => a.name.localeCompare(b.name));
  }, [playerPickerShowAll, playerQuery, players]);

  const selectPlayer = useCallback((player: PlayerChoice) => {
    setPlayerId(player.id);
    setPlayerQuery(player.name);
    setPlayerPickerOpen(false);
    setPlayerPickerShowAll(false);
  }, []);

  useEffect(() => {
    if (!playerPickerOpen) return;
    const closePlayerPicker = (event: PointerEvent) => {
      if (!playerPickerRef.current?.contains(event.target as Node)) {
        setPlayerPickerOpen(false);
        setPlayerPickerShowAll(false);
      }
    };
    document.addEventListener('pointerdown', closePlayerPicker);
    return () => document.removeEventListener('pointerdown', closePlayerPicker);
  }, [playerPickerOpen]);

  useEffect(() => {
    setDrillExerciseOptions((previous) => {
      const fromProps = exercises.filter((exercise) => isDrillEligibleCategory(exercise.category));
      if (previous.length === 0) return fromProps;
      const byName = new Map<string, { id: number; name: string; category: string; instructionVideoUrl: string | null }>();
      for (const option of [...fromProps, ...previous]) byName.set(option.name.toLowerCase(), option);
      return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }, [exercises]);

  useEffect(() => {
    const selected = players.find((player) => player.id === playerId);
    if (!selected) return;
    setPlayerQuery(selected.name);
  }, [playerId, players]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => {
      const mobile = media.matches;
      setIsMobileSchedule(mobile);
      if (mobile) {
        setView((previous) => (previous === 'month' ? 'day' : previous));
        setMobilePaletteCollapsed(true);
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const q = playerQuery.trim().toLowerCase();
    if (!q) return;
    const exact = players.find((player) => player.name.trim().toLowerCase() === q);
    if (!exact) return;
    if (exact.id === playerId) return;
    setPlayerId(exact.id);
  }, [playerId, playerQuery, players]);

  const visibleRange = useMemo(() => {
    if (view === 'cycle') return { startDate: anchorDate, endDate: addDays(anchorDate, 1) };
    if (view === 'throwing') {
      const monthStart = startOfMonth(anchorDate);
      const monthEnd = endOfMonthExclusive(anchorDate);
      return { startDate: monthStart, endDate: monthEnd, monthStart };
    }
    if (view === 'day') return { startDate: anchorDate, endDate: addDays(anchorDate, 1) };
    if (view === 'week') return { startDate: startOfWeek(anchorDate), endDate: endOfWeekExclusive(anchorDate) };
    const monthStart = startOfMonth(anchorDate);
    const monthEnd = endOfMonthExclusive(anchorDate);
    return { startDate: monthStart, endDate: monthEnd, monthStart };
  }, [anchorDate, view]);

  const loadItems = useCallback(async () => {
    if (!playerId) {
      setItems([]);
      return;
    }
    if (view === 'throwing' || view === 'bullpens' || view === 'velocity' || view === 'drills') {
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (view === 'cycle') {
        const params = new URLSearchParams({ playerId: String(playerId) });
        const response = await fetchWithTimeout(`/api/admin/schedule/cycle?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as { items?: ProgramItemRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load 3-Day Cycle.');
        setItems(Array.isArray(payload.items) ? payload.items : []);
        return;
      }
      const params = new URLSearchParams({
        playerId: String(playerId),
        startDate: visibleRange.startDate,
        endDate: visibleRange.endDate,
      });
      const response = await fetchWithTimeout(`/api/admin/schedule/assignments?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { items?: ProgramItemRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load schedule.');
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load schedule.');
    } finally {
      setLoading(false);
    }
  }, [playerId, view, visibleRange.endDate, visibleRange.startDate]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const response = await fetchWithTimeout('/api/admin/schedule/templates', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { templates?: TemplateChoice[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load templates.');
      setTemplates(Array.isArray(payload.templates) ? payload.templates : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    let cancelled = false;
    const loadThrowingState = async () => {
      throwingStateLoadedRef.current = false;
      if (!playerId) {
        // No player selected — load shared templates only so admin can manage them.
        setThrowingByDate({});
        setThrowingWeekNotes({});
        setThrowingTemplates([]);
        setSelectedThrowingTemplateId('');
        setThrowingTemplateName('');
        setThrowingTemplateWeekCount(4);
        setThrowingTemplateByCell({});
        setThrowingTemplateWeekNotes({});
        setBullpenNotes('');
        setCycleNotes('');
        setDrillsRowCount(DEFAULT_DRILL_ROW_COUNT);
        setDrillsRows(normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
        setDrillsNotes('');
        setPostDrillsRowCount(DEFAULT_DRILL_ROW_COUNT);
        setPostDrillsRows(normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
        setSelectedPreDrillTemplateId('');
        setSelectedPostDrillTemplateId('');
        setPreDrillTemplateName('');
        setPostDrillTemplateName('');
        try {
          const sharedResponse = await fetchWithTimeout(`/api/admin/schedule/throwing?playerId=0`, { cache: 'no-store' });
          const sharedPayload = (await sharedResponse.json().catch(() => ({}))) as {
            templates?: ThrowingTemplate[];
            bullpenTemplates?: BullpenTemplate[];
            velocityTemplates?: BullpenTemplate[];
            preThrowDrillTemplates?: DrillTemplate[];
            postThrowDrillTemplates?: DrillTemplate[];
          };
          if (cancelled) return;
          const sharedThrowingTemplates = Array.isArray(sharedPayload.templates) ? sharedPayload.templates : [];
          const sharedBullpenTemplates = Array.isArray(sharedPayload.bullpenTemplates) ? sharedPayload.bullpenTemplates.map((t) => ({
            id: String(t.id ?? ''), name: String(t.name ?? ''), rowCount: Math.max(1, Number(t.rowCount ?? 20)),
            columns: Array.isArray(t.columns) ? t.columns.map((c) => String(c ?? '')) : [...DEFAULT_BULLPEN_COLUMNS],
            columnTypes: normalizeBullpenColumnTypes(t.columnTypes, Array.isArray(t.columns) && t.columns.length ? t.columns.length : DEFAULT_BULLPEN_COLUMNS.length),
            rows: Array.isArray(t.rows) ? t.rows : [], updatedAt: String(t.updatedAt ?? ''),
            category: (BULLPEN_CATEGORIES as readonly string[]).includes(String(t.category ?? '').trim()) ? String(t.category).trim() as BullpenCategory : '' as BullpenCategory,
          })).filter((t) => t.id && t.name) : [];
          const sharedVelocityTemplates = Array.isArray(sharedPayload.velocityTemplates) ? sharedPayload.velocityTemplates.map((t) => ({
            id: String(t.id ?? ''), name: String(t.name ?? ''), rowCount: Math.max(1, Number(t.rowCount ?? 20)),
            columns: Array.isArray(t.columns) ? t.columns.map((c) => String(c ?? '')) : [...DEFAULT_BULLPEN_COLUMNS],
            columnTypes: normalizeBullpenColumnTypes(t.columnTypes, Array.isArray(t.columns) && t.columns.length ? t.columns.length : DEFAULT_BULLPEN_COLUMNS.length),
            rows: Array.isArray(t.rows) ? t.rows : [], updatedAt: String(t.updatedAt ?? ''),
          })).filter((t) => t.id && t.name) : [];
          setThrowingTemplates(sharedThrowingTemplates);
          if (sharedThrowingTemplates.length > 0) {
            const first = sharedThrowingTemplates[0];
            setSelectedThrowingTemplateId(first.id);
            setThrowingTemplateName(first.name);
            setThrowingTemplateWeekCount(first.weekCount);
            setThrowingTemplateByCell(normalizeThrowingTemplateCells(first.byCell));
            setThrowingTemplateWeekNotes(first.weekNotes ?? {});
          } else {
            setSelectedThrowingTemplateId('');
            setThrowingTemplateName('');
            setThrowingTemplateWeekCount(4);
            setThrowingTemplateByCell({});
            setThrowingTemplateWeekNotes({});
          }
          setBullpenTemplates(sharedBullpenTemplates);
          setVelocityTemplates(sharedVelocityTemplates);
          setPreThrowDrillTemplates(normalizeDrillTemplates(sharedPayload.preThrowDrillTemplates));
          setPostThrowDrillTemplates(normalizeDrillTemplates(sharedPayload.postThrowDrillTemplates));
          setBullpenCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
          setSelectedBullpenTemplateId('');
        } catch {
          setBullpenTemplates([]);
          setVelocityTemplates([]);
          setPreThrowDrillTemplates([]);
          setPostThrowDrillTemplates([]);
          setBullpenCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
          setSelectedBullpenTemplateId('');
        }
        throwingStateLoadedRef.current = true;
        return;
      }
      try {
        const response = await fetchWithTimeout(`/api/admin/schedule/throwing?playerId=${playerId}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          byDate?: Record<string, ThrowingDayEntry>;
          weekNotes?: Record<string, string>;
          templates?: ThrowingTemplate[];
          bullpenState?: BullpenState;
          bullpenTemplates?: BullpenTemplate[];
          velocityState?: BullpenState;
          velocityTemplates?: BullpenTemplate[];
          drillsState?: unknown;
          preThrowDrillTemplates?: DrillTemplate[];
          postThrowDrillTemplates?: DrillTemplate[];
          catchPlayNotes?: { highDay?: string; mediumDay?: string; lowDay?: string };
          cycleNotes?: string;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load throwing calendar.');
        if (cancelled) return;
        setThrowingByDate(payload.byDate ?? {});
        setThrowingWeekNotes(payload.weekNotes ?? {});
        const nextPreDrillTemplates = normalizeDrillTemplates(payload.preThrowDrillTemplates);
        const nextPostDrillTemplates = normalizeDrillTemplates(payload.postThrowDrillTemplates);
        setPreThrowDrillTemplates(nextPreDrillTemplates);
        setPostThrowDrillTemplates(nextPostDrillTemplates);
        const nextTemplates = Array.isArray(payload.templates) ? payload.templates : [];
        setThrowingTemplates(nextTemplates);
        if (nextTemplates.length > 0) {
          const first = nextTemplates[0];
          setSelectedThrowingTemplateId(first.id);
          setThrowingTemplateName(first.name);
          setThrowingTemplateWeekCount(first.weekCount);
          setThrowingTemplateByCell(normalizeThrowingTemplateCells(first.byCell));
          setThrowingTemplateWeekNotes(first.weekNotes ?? {});
        } else {
          setSelectedThrowingTemplateId('');
          setThrowingTemplateName('');
          setThrowingTemplateWeekCount(4);
          setThrowingTemplateByCell({});
          setThrowingTemplateWeekNotes({});
        }
        const bullpenState = payload.bullpenState;
        if (bullpenState && typeof bullpenState === 'object') {
          const current = bullpenState.current ?? { title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: [] };
          const rowCount = Math.max(BULLPEN_MIN_ROWS, Math.min(BULLPEN_MAX_ROWS, Number(current.rowCount ?? 20) || 20));
          const columns = Array.isArray(current.columns)
            ? current.columns.map((value) => String(value ?? '').trim()).filter(Boolean).slice(0, 16)
            : [...DEFAULT_BULLPEN_COLUMNS];
          const safeColumns = columns.length ? columns : [...DEFAULT_BULLPEN_COLUMNS];
          setBullpenCurrent({
            title: String(current.title ?? ''),
            rowCount,
            columns: safeColumns,
            columnTypes: normalizeBullpenColumnTypes(current.columnTypes, safeColumns.length),
            rows: buildBullpenRows(rowCount, safeColumns.length, current.rows),
          });
          const nextBullpenTemplatesSource = Array.isArray(payload.bullpenTemplates)
            ? payload.bullpenTemplates
            : Array.isArray(bullpenState.templates)
              ? bullpenState.templates
              : [];
          const nextBullpenTemplates = nextBullpenTemplatesSource.map((template) => ({
            id: String(template.id ?? ''),
            name: String(template.name ?? ''),
            rowCount: Math.max(BULLPEN_MIN_ROWS, Math.min(BULLPEN_MAX_ROWS, Number(template.rowCount ?? 20) || 20)),
            columns: Array.isArray(template.columns)
              ? template.columns.map((value) => String(value ?? '').trim()).filter(Boolean).slice(0, 16)
              : [...DEFAULT_BULLPEN_COLUMNS],
            columnTypes: normalizeBullpenColumnTypes(template.columnTypes, Array.isArray(template.columns) && template.columns.length ? template.columns.length : DEFAULT_BULLPEN_COLUMNS.length),
            rows: buildBullpenRows(
              Number(template.rowCount ?? 20) || 20,
              Array.isArray(template.columns) && template.columns.length ? template.columns.length : DEFAULT_BULLPEN_COLUMNS.length,
              template.rows
            ),
            updatedAt: String(template.updatedAt ?? ''),
            category: (BULLPEN_CATEGORIES as readonly string[]).includes(String(template.category ?? '').trim()) ? String(template.category).trim() as BullpenCategory : '' as BullpenCategory,
          })).filter((template) => template.id && template.name);
          setBullpenTemplates(nextBullpenTemplates);
          setSelectedBullpenTemplateId(String(bullpenState.selectedTemplateId ?? ''));
          setBullpenNotes(String(bullpenState.notes ?? ''));
          const fromApiVisible = Array.isArray(bullpenState.visibleTemplateIds)
            ? bullpenState.visibleTemplateIds.map((value) => String(value ?? '').trim()).filter(Boolean)
            : [];
          setVisibleBullpenTemplateIds(fromApiVisible.length > 0 ? fromApiVisible : nextBullpenTemplates.map((row) => row.id));
        } else {
          setBullpenCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
          setBullpenTemplates([]);
          setSelectedBullpenTemplateId('');
          setVisibleBullpenTemplateIds([]);
          setBullpenNotes('');
        }
        const velocityState = payload.velocityState;
        if (velocityState && typeof velocityState === 'object') {
          const current = velocityState.current ?? { title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: [] };
          const rowCount = Math.max(BULLPEN_MIN_ROWS, Math.min(BULLPEN_MAX_ROWS, Number(current.rowCount ?? 20) || 20));
          const columns = Array.isArray(current.columns)
            ? current.columns.map((value) => String(value ?? '').trim()).filter(Boolean).slice(0, 16)
            : [...DEFAULT_BULLPEN_COLUMNS];
          const safeColumns = columns.length ? columns : [...DEFAULT_BULLPEN_COLUMNS];
          setVelocityCurrent({
            title: String(current.title ?? ''),
            rowCount,
            columns: safeColumns,
            columnTypes: normalizeBullpenColumnTypes(current.columnTypes, safeColumns.length),
            rows: buildBullpenRows(rowCount, safeColumns.length, current.rows),
          });
          const nextVelocityTemplatesSource = Array.isArray(payload.velocityTemplates)
            ? payload.velocityTemplates
            : Array.isArray(velocityState.templates)
              ? velocityState.templates
              : [];
          const nextVelocityTemplates = nextVelocityTemplatesSource
	            .map((template) => ({
	              id: String(template.id ?? ''),
	              name: String(template.name ?? ''),
	              rowCount: Math.max(BULLPEN_MIN_ROWS, Math.min(BULLPEN_MAX_ROWS, Number(template.rowCount ?? 20) || 20)),
              columns: Array.isArray(template.columns)
                ? template.columns.map((value) => String(value ?? '').trim()).filter(Boolean).slice(0, 16)
                : [...DEFAULT_BULLPEN_COLUMNS],
              columnTypes: normalizeBullpenColumnTypes(template.columnTypes, Array.isArray(template.columns) && template.columns.length ? template.columns.length : DEFAULT_BULLPEN_COLUMNS.length),
              rows: buildBullpenRows(
                Number(template.rowCount ?? 20) || 20,
                Array.isArray(template.columns) && template.columns.length ? template.columns.length : DEFAULT_BULLPEN_COLUMNS.length,
                template.rows
              ),
              updatedAt: String(template.updatedAt ?? ''),
            }))
            .filter((template) => template.id && template.name);
          setVelocityTemplates(nextVelocityTemplates);
          setSelectedVelocityTemplateId(String(velocityState.selectedTemplateId ?? ''));
          setVelocityNotes(String(velocityState.notes ?? ''));
          const fromApiVisible = Array.isArray(velocityState.visibleTemplateIds)
            ? velocityState.visibleTemplateIds.map((value) => String(value ?? '').trim()).filter(Boolean)
            : [];
          setVisibleVelocityTemplateIds(fromApiVisible.length > 0 ? fromApiVisible : nextVelocityTemplates.map((row) => row.id));
        } else {
          setVelocityCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
          setVelocityTemplates([]);
          setSelectedVelocityTemplateId('');
          setVisibleVelocityTemplateIds([]);
          setVelocityNotes('');
        }
        const nextDrillsState = normalizeDrillsState(payload.drillsState);
        setDrillsNotes(nextDrillsState.notes);
        setDrillsRowCount(nextDrillsState.pre.rowCount);
        setDrillsRows(nextDrillsState.pre.rows);
        setSelectedPreDrillTemplateId(nextDrillsState.pre.selectedTemplateId);
        setPreDrillTemplateName(nextPreDrillTemplates.find((template) => template.id === nextDrillsState.pre.selectedTemplateId)?.name ?? '');
        setPostDrillsRowCount(nextDrillsState.post.rowCount);
        setPostDrillsRows(nextDrillsState.post.rows);
        setSelectedPostDrillTemplateId(nextDrillsState.post.selectedTemplateId);
        setPostDrillTemplateName(nextPostDrillTemplates.find((template) => template.id === nextDrillsState.post.selectedTemplateId)?.name ?? '');
        setCatchPlayHighDay(String(payload.catchPlayNotes?.highDay ?? ''));
        setCatchPlayMediumDay(String(payload.catchPlayNotes?.mediumDay ?? ''));
        setCatchPlayLowDay(String(payload.catchPlayNotes?.lowDay ?? ''));
        setCycleNotes(String(payload.cycleNotes ?? ''));
        throwingStateLoadedRef.current = true;
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load throwing calendar.');
        setThrowingByDate({});
        setThrowingWeekNotes({});
        setThrowingTemplates([]);
        setSelectedThrowingTemplateId('');
        setThrowingTemplateName('');
        setThrowingTemplateWeekCount(4);
        setThrowingTemplateByCell({});
        setThrowingTemplateWeekNotes({});
        setBullpenCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
        setBullpenTemplates([]);
        setSelectedBullpenTemplateId('');
        setVisibleBullpenTemplateIds([]);
        setBullpenNotes('');
        setVelocityCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
        setVelocityTemplates([]);
        setSelectedVelocityTemplateId('');
        setVisibleVelocityTemplateIds([]);
        setVelocityNotes('');
        setDrillsNotes('');
        setDrillsRowCount(DEFAULT_DRILL_ROW_COUNT);
        setDrillsRows(normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
        setDrillsNotes('');
        setPostDrillsRowCount(DEFAULT_DRILL_ROW_COUNT);
        setPostDrillsRows(normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
        setSelectedPreDrillTemplateId('');
        setSelectedPostDrillTemplateId('');
        setPreThrowDrillTemplates([]);
        setPostThrowDrillTemplates([]);
        setCatchPlayHighDay('');
        setCatchPlayMediumDay('');
        setCatchPlayLowDay('');
        setCycleNotes('');
        throwingStateLoadedRef.current = true;
      }
    };
    void loadThrowingState();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    if (!throwingStateLoadedRef.current) return;
    // No player: only save shared template libraries.
    if (!playerId) {
      const handle = setTimeout(() => {
        void fetchWithTimeout('/api/admin/schedule/throwing', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            playerId: 0,
            byDate: {},
            weekNotes: {},
            templates: throwingTemplates,
            bullpenState: { current: bullpenCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
            bullpenTemplates,
            velocityState: { current: velocityCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
            velocityTemplates,
            drillsState: normalizeDrillsState(null),
            preThrowDrillTemplates,
            postThrowDrillTemplates,
          }),
        }).catch(() => {});
      }, 350);
      return () => clearTimeout(handle);
    }
    const handle = setTimeout(() => {
      void fetchWithTimeout('/api/admin/schedule/throwing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          byDate: throwingByDate,
          weekNotes: throwingWeekNotes,
          templates: throwingTemplates,
          bullpenState: {
            current: bullpenCurrent,
            selectedTemplateId: selectedBullpenTemplateId,
            visibleTemplateIds: visibleBullpenTemplateIds,
            notes: bullpenNotes,
          },
          bullpenTemplates,
          velocityState: {
            current: velocityCurrent,
            selectedTemplateId: selectedVelocityTemplateId,
            visibleTemplateIds: visibleVelocityTemplateIds,
            notes: velocityNotes,
          },
          velocityTemplates,
          drillsState: {
            notes: drillsNotes,
            pre: { rowCount: drillsRowCount, rows: drillsRows.slice(0, drillsRowCount), selectedTemplateId: selectedPreDrillTemplateId },
            post: { rowCount: postDrillsRowCount, rows: postDrillsRows.slice(0, postDrillsRowCount), selectedTemplateId: selectedPostDrillTemplateId },
          } satisfies DrillsState,
          preThrowDrillTemplates,
          postThrowDrillTemplates,
          catchPlayNotes: { highDay: catchPlayHighDay, mediumDay: catchPlayMediumDay, lowDay: catchPlayLowDay },
          cycleNotes,
        }),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [playerId, throwingByDate, throwingWeekNotes, throwingTemplates, bullpenCurrent, bullpenTemplates, selectedBullpenTemplateId, visibleBullpenTemplateIds, bullpenNotes, velocityCurrent, velocityTemplates, selectedVelocityTemplateId, visibleVelocityTemplateIds, velocityNotes, drillsNotes, drillsRowCount, drillsRows, postDrillsRowCount, postDrillsRows, selectedPreDrillTemplateId, selectedPostDrillTemplateId, preThrowDrillTemplates, postThrowDrillTemplates, catchPlayHighDay, catchPlayMediumDay, catchPlayLowDay, cycleNotes]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplateName('');
      setTemplateDayItems({});
      return;
    }
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
    if (!selectedTemplate) return;
    setTemplateName(selectedTemplate.name);
    setTemplateWeekCount(Math.max(1, Math.ceil(Math.max(1, selectedTemplate.totalDays) / 7)));
    const map: Record<number, TemplateDraftItem[]> = {};
    selectedTemplate.days.forEach((day) => {
      map[day.dayOffset] = day.items
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          workoutId: item.workoutId,
          workoutName: item.workoutName,
          workoutCategory: item.workoutCategory,
          prescribedSets: item.prescribedSets ?? undefined,
          prescribedReps: item.prescribedReps ?? undefined,
          prescribedLoad: item.prescribedLoad ?? undefined,
          prescribedNotes: item.prescribedNotes ?? undefined,
        }));
    });
    setTemplateDayItems(map);
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (!throwingApplyTemplateId) return;
    if (throwingTemplates.some((template) => template.id === throwingApplyTemplateId)) return;
    setThrowingApplyTemplateId('');
  }, [throwingApplyTemplateId, throwingTemplates]);

  useEffect(() => {
    if (!selectedBullpenTemplateId) return;
    if (bullpenTemplates.some((template) => template.id === selectedBullpenTemplateId)) return;
    setSelectedBullpenTemplateId('');
  }, [selectedBullpenTemplateId, bullpenTemplates]);

  useEffect(() => {
    setVisibleBullpenTemplateIds((prev) => prev.filter((id) => bullpenTemplates.some((template) => template.id === id)));
  }, [bullpenTemplates]);
  useEffect(() => {
    if (!selectedVelocityTemplateId) return;
    if (velocityTemplates.some((template) => template.id === selectedVelocityTemplateId)) return;
    setSelectedVelocityTemplateId('');
  }, [selectedVelocityTemplateId, velocityTemplates]);
  useEffect(() => {
    setVisibleVelocityTemplateIds((prev) => prev.filter((id) => velocityTemplates.some((template) => template.id === id)));
  }, [velocityTemplates]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ProgramItemRow[]>();
    for (const item of items) {
      const list = map.get(item.dayDate) ?? [];
      list.push(item);
      map.set(item.dayDate, list);
    }
    return map;
  }, [items]);

  const monthCells = useMemo(() => (view === 'month' ? makeMonthGrid(anchorDate) : []), [anchorDate, view]);
  const throwingMonthCells = useMemo(() => (view === 'throwing' ? makeMonthGrid(anchorDate) : []), [anchorDate, view]);
  const throwingWeekCells = useMemo(
    () => (view === 'throwing' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchorDate), i)) : []),
    [anchorDate, view]
  );
  const throwingDayCells = useMemo(() => (view === 'throwing' ? [anchorDate] : []), [anchorDate, view]);
  const throwingWeeks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < throwingMonthCells.length; i += 7) out.push(throwingMonthCells.slice(i, i + 7));
    return out;
  }, [throwingMonthCells]);
  const throwingTemplateWeeks = useMemo(
    () => Array.from({ length: Math.max(THROWING_MIN_WEEKS, throwingTemplateWeekCount) }, (_, idx) => idx),
    [throwingTemplateWeekCount]
  );
  const weekCells = useMemo(() => (view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchorDate), i)) : []), [anchorDate, view]);
  const visibleWeekCells = useMemo(() => weekCells.slice(0, 7), [weekCells]);
  const dayCells = useMemo(() => (view === 'day' ? [anchorDate] : []), [anchorDate, view]);
  const periodLabel = useMemo(() => {
    if (view === 'cycle') return '3-Day Cycle';
    if (view === 'bullpens') return 'Bullpens';
    if (view === 'velocity') return 'Velocity';
    if (view === 'drills') return 'Drills';
    if (view === 'throwing') {
      if (throwingBuilderMode === 'weeks') return 'Throwing Calendar · Week Builder';
      if (throwingCalendarView === 'day') {
        return `Throwing Calendar · ${fromIsoDate(anchorDate).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })}`;
      }
      if (throwingCalendarView === 'week') {
        const start = startOfWeek(anchorDate);
        const end = addDays(start, 6);
        const startText = fromIsoDate(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
        const endText = fromIsoDate(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        return `Throwing Calendar · ${startText} - ${endText}`;
      }
      const anchor = fromIsoDate(anchorDate);
      return `Throwing Calendar · ${anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
    }
    const anchor = fromIsoDate(anchorDate);
    if (view === 'month') {
      return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    if (view === 'week') {
      const start = startOfWeek(anchorDate);
      const end = addDays(start, 6);
      const startText = fromIsoDate(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const endText = fromIsoDate(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return `${startText} - ${endText}`;
    }
    return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }, [anchorDate, throwingBuilderMode, throwingCalendarView, view]);

  const getThrowingTemplateCellKey = (weekIndex: number, dayIndex: number) => `w${weekIndex + 1}-d${dayIndex}`;
  const emptyThrowingEntry: ThrowingDayEntry = { intensity: '', distance: '', throwsText: '', drills: '', bullpen: '' };

  const resizeDrillsNoteTextarea = useCallback(() => {
    const textarea = drillsNoteTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(52, textarea.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    resizeDrillsNoteTextarea();
  }, [drillsNotes, resizeDrillsNoteTextarea]);
  const normalizeThrowingEntry = (entry: Partial<ThrowingDayEntry> | undefined | null): ThrowingDayEntry => ({
    intensity: String(entry?.intensity ?? ''),
    distance: String(entry?.distance ?? ''),
    throwsText: String(entry?.throwsText ?? ''),
    drills: String(entry?.drills ?? ''),
    bullpen: String(entry?.bullpen ?? ''),
  });
  const normalizeThrowingTemplateCells = (cells: Record<string, Partial<ThrowingDayEntry>> | undefined | null): Record<string, ThrowingDayEntry> =>
    Object.fromEntries(
      Object.entries(cells ?? {}).map(([key, entry]) => [key, normalizeThrowingEntry(entry)])
    );
  const hasThrowingEntry = (entry: ThrowingDayEntry | undefined): boolean =>
    Boolean(
      entry &&
        (String(entry.intensity ?? '').trim() ||
          String(entry.distance ?? '').trim() ||
          String(entry.throwsText ?? '').trim() ||
          String(entry.drills ?? '').trim() ||
          String(entry.bullpen ?? '').trim())
    );
  const filteredWorkouts = useMemo(() => {
    const q = workoutQuery.trim().toLowerCase();
    if (!q) return workouts;
    return workouts.filter((workout) => workout.name.toLowerCase().includes(q));
  }, [workoutQuery, workouts]);
  const workoutCategories = useMemo(() => {
    const byCategory = new Map<string, WorkoutChoice[]>();
    for (const workout of filteredWorkouts) {
      const key = String(workout.category || 'Uncategorized').trim() || 'Uncategorized';
      const list = byCategory.get(key) ?? [];
      list.push(workout);
      byCategory.set(key, list);
    }
    return Array.from(byCategory.entries())
      .map(([category, items]) => ({
        category,
        items: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredWorkouts]);
  const selectedCategoryWorkouts = useMemo(() => {
    if (!selectedWorkoutCategory) return [];
    return workoutCategories.find((group) => group.category === selectedWorkoutCategory)?.items ?? [];
  }, [selectedWorkoutCategory, workoutCategories]);
  const workoutSuggestions = useMemo(() => {
    const q = workoutQuery.trim().toLowerCase();
    if (!q) return [];
    return workouts
      .filter((workout) => workout.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [workoutQuery, workouts]);
  const filteredTemplates = useMemo(() => {
    const query = workoutQuery.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) => template.name.toLowerCase().includes(query));
  }, [templates, workoutQuery]);
  const hasWorkoutSearch = paletteMode === 'workouts' && workoutQuery.trim().length > 0;
  const templateSuggestions = useMemo(() => {
    const query = workoutQuery.trim().toLowerCase();
    if (!query) return [];
    return templates.filter((template) => template.name.toLowerCase().includes(query)).slice(0, 8);
  }, [templates, workoutQuery]);
  const templateGridOffsets = useMemo(
    () => Array.from({ length: Math.max(1, templateWeekCount) * 7 }, (_, index) => index),
    [templateWeekCount]
  );

  const applyTemplate = async (templateId: number, startDate: string) => {
    if (!playerId) return;
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/schedule/templates/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, templateId, startDate, programName: 'Current Program' }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to apply template.');
      await loadItems();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Failed to apply template.');
    }
  };

  const saveTemplate = async () => {
    setError('');
    try {
      const days = Object.entries(templateDayItems)
        .map(([offsetRaw, dayItems]) => ({
          dayOffset: Number(offsetRaw),
          items: dayItems.map((item) => ({
            workoutId: item.workoutId,
            prescribedSets: item.prescribedSets ?? '',
            prescribedReps: item.prescribedReps ?? '',
            prescribedLoad: item.prescribedLoad ?? '',
            prescribedNotes: item.prescribedNotes ?? '',
          })),
        }))
        .filter((day) => Number.isFinite(day.dayOffset) && day.dayOffset >= 0 && day.items.length > 0)
        .sort((a, b) => a.dayOffset - b.dayOffset);
      const response = await fetchWithTimeout('/api/admin/schedule/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId ?? undefined,
          name: templateName,
          days,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; templateId?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save template.');
      await loadTemplates();
      if (Number.isFinite(Number(payload.templateId ?? 0)) && Number(payload.templateId ?? 0) > 0) {
        setSelectedTemplateId(Number(payload.templateId));
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save template.');
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) return;
    const confirmed = window.confirm('Delete this template?');
    if (!confirmed) return;
    setError('');
    try {
      const response = await fetchWithTimeout(`/api/admin/schedule/templates?templateId=${selectedTemplateId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete template.');
      setSelectedTemplateId(null);
      setTemplateName('');
      setTemplateDayItems({});
      await loadTemplates();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete template.');
    }
  };

  const movePeriod = (direction: -1 | 1) => {
    if (view === 'cycle') return;
    if (view === 'day') setAnchorDate((prev) => addDays(prev, direction));
    else if (view === 'throwing') {
      if (throwingBuilderMode === 'weeks') return;
      if (throwingCalendarView === 'day') {
        setAnchorDate((prev) => addDays(prev, direction));
      } else if (throwingCalendarView === 'week') {
        setAnchorDate((prev) => addDays(prev, direction * 7));
      } else {
        const date = fromIsoDate(anchorDate);
        date.setUTCMonth(date.getUTCMonth() + direction);
        setAnchorDate(toIsoDate(date));
      }
    } else if (view === 'bullpens' || view === 'velocity' || view === 'drills') {
      return;
    }
    else if (view === 'week') setAnchorDate((prev) => addDays(prev, direction * 7));
    else {
      const date = fromIsoDate(anchorDate);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchorDate(toIsoDate(date));
    }
  };

  const jumpToCurrentForView = (mode: ViewMode) => {
    if (mode === 'day' || mode === 'week' || mode === 'cycle' || mode === 'throwing' || mode === 'bullpens' || mode === 'velocity') {
      setAnchorDate(toIsoDate(new Date()));
    }
  };

  const downloadThrowingCalendar = async () => {
    if (view !== 'throwing') return;
    const node = throwingCalendarRef.current;
    if (!node) return;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const isLightTheme =
        typeof document !== 'undefined' &&
        document.body.classList.contains('theme-light');
      const pageBackground = isLightTheme ? '#f8fafc' : '#05060a';
      const renderCanvas = async (el: HTMLElement) =>
        html2canvas(el, {
          backgroundColor: pageBackground,
          scale: 2,
          useCORS: true,
          onclone: (doc) => {
            if (isLightTheme) doc.body.classList.add('theme-light');
            else doc.body.classList.remove('theme-light');
            doc.documentElement.style.background = pageBackground;
            doc.body.style.background = pageBackground;
            const clonedRoot = doc.body.querySelector('[data-throwing-export-root="true"]');
            if (!clonedRoot) return;
            if (clonedRoot instanceof HTMLElement) {
              clonedRoot.style.background = pageBackground;
              clonedRoot.style.color = isLightTheme ? '#0f172a' : '#f8fafc';
              clonedRoot.style.overflow = 'visible';
            }
            const fields = clonedRoot.querySelectorAll('input[placeholder], textarea[placeholder]');
            fields.forEach((field) => {
              field.removeAttribute('placeholder');
            });
            const formFields = clonedRoot.querySelectorAll('input.portal-throwing-field, textarea.portal-throwing-notes');
            formFields.forEach((field) => {
              if (!(field instanceof HTMLElement)) return;
              const tagName = field.tagName.toLowerCase();
              const isTextarea = tagName === 'textarea';
              if (tagName !== 'input' && !isTextarea) return;
              const formField = field as HTMLInputElement | HTMLTextAreaElement;
              const computed = doc.defaultView?.getComputedStyle(field);
              const replacement = doc.createElement('div');
              replacement.textContent = formField.value || '';
              replacement.className = field.className;
              replacement.style.boxSizing = 'border-box';
              replacement.style.width = '100%';
              replacement.style.minWidth = '0';
              replacement.style.minHeight = computed?.minHeight || (isTextarea ? '100%' : '36px');
              replacement.style.height = isTextarea ? '100%' : (computed?.height || '36px');
              replacement.style.padding = computed?.padding || '0.42rem 0.55rem';
              replacement.style.border = computed?.border || (isLightTheme ? '1px solid rgba(15, 23, 42, 0.2)' : '1px solid rgba(255, 255, 255, 0.24)');
              replacement.style.borderRadius = computed?.borderRadius || '6px';
              replacement.style.background = computed?.background || (isLightTheme ? '#f8fbff' : 'rgba(17, 20, 28, 0.92)');
              replacement.style.color = computed?.color || (isLightTheme ? '#0f172a' : '#e7edf7');
              replacement.style.font = computed?.font || 'inherit';
              replacement.style.fontSize = computed?.fontSize || '12px';
              replacement.style.fontWeight = computed?.fontWeight || '500';
              replacement.style.lineHeight = isTextarea ? '1.25' : (computed?.lineHeight || '1.2');
              replacement.style.display = 'flex';
              replacement.style.alignItems = isTextarea ? 'flex-start' : 'center';
              replacement.style.justifyContent = 'flex-start';
              replacement.style.textAlign = 'left';
              replacement.style.whiteSpace = isTextarea ? 'pre-wrap' : 'nowrap';
              replacement.style.overflowWrap = isTextarea ? 'anywhere' : 'normal';
              replacement.style.wordBreak = 'normal';
              replacement.style.overflow = 'hidden';
              field.replaceWith(replacement);
            });
            clonedRoot.querySelectorAll('.portal-schedule-day-body').forEach((body) => {
              if (!(body instanceof HTMLElement)) return;
              body.style.overflow = 'hidden';
              body.style.overflowX = 'hidden';
              body.style.overflowY = 'hidden';
            });
            clonedRoot.querySelectorAll('[data-throwing-intensity-tone]').forEach((cell) => {
              if (!(cell instanceof HTMLElement)) return;
              const tone = cell.dataset.throwingIntensityTone;
              if (tone === 'low') {
                cell.style.background = isLightTheme ? 'rgba(153, 27, 27, 0.30)' : '#3f0c0f';
                cell.style.boxShadow = isLightTheme ? 'inset 0 0 0 1px rgba(239, 68, 68, 0.55)' : 'inset 0 0 0 1px #8f2024';
              } else if (tone === 'medium') {
                cell.style.background = isLightTheme ? 'rgba(202, 138, 4, 0.28)' : '#4a3308';
                cell.style.boxShadow = isLightTheme ? 'inset 0 0 0 1px rgba(250, 204, 21, 0.55)' : 'inset 0 0 0 1px #9a7404';
              } else if (tone === 'high') {
                cell.style.background = isLightTheme ? 'rgba(21, 128, 61, 0.30)' : '#0b3218';
                cell.style.boxShadow = isLightTheme ? 'inset 0 0 0 1px rgba(74, 222, 128, 0.55)' : 'inset 0 0 0 1px #1f7a3c';
              }
            });
          },
        });
      const loadImageDataUrl = async (src: string): Promise<string | null> => {
        try {
          const response = await fetch(src);
          if (!response.ok) return null;
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(new Error('Failed reading logo.'));
            reader.readAsDataURL(blob);
          });
          return dataUrl || null;
        } catch {
          return null;
        }
      };
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const targetWidth = pageWidth - margin * 2;
      const logoData = await loadImageDataUrl('/pitching-coach-u-logo.png');
      const logoW = 56;
      const logoH = 56;
      const selectedPlayerName = players.find((player) => player.id === playerId)?.name ?? '';
      const selectedThrowingTemplateName =
        throwingBuilderMode === 'weeks'
          ? String(throwingTemplates.find((template) => template.id === selectedThrowingTemplateId)?.name ?? '').trim()
          : '';
      const monthYear =
        throwingBuilderMode === 'weeks'
          ? selectedThrowingTemplateName
          : fromIsoDate(anchorDate).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            });
      const headerTitleSize = 20;
      const headerMetaSize = 12;
      const headerBlockHeight = 78;
      const sectionGap = 8;

      const paintPageBackground = () => {
        if (isLightTheme) pdf.setFillColor(248, 250, 252);
        else pdf.setFillColor(5, 6, 10);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      };

      const drawCenteredHeader = () => {
        pdf.setTextColor(isLightTheme ? 15 : 255, isLightTheme ? 23 : 255, isLightTheme ? 42 : 255);
        if (logoData) {
          pdf.addImage(logoData, 'PNG', margin, margin, logoW, logoH);
          pdf.addImage(logoData, 'PNG', pageWidth - margin - logoW, margin, logoW, logoH);
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(headerTitleSize);
        pdf.text('Throwing Calendar', pageWidth / 2, margin + 18, { align: 'center' });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(headerMetaSize);
        if (monthYear) pdf.text(monthYear, pageWidth / 2, margin + 40, { align: 'center' });
        pdf.text(selectedPlayerName, pageWidth / 2, margin + 58, { align: 'center' });
      };

      const weekdayEl = node.querySelector('[data-throwing-weekdays="true"]');
      const weekEls = Array.from(node.querySelectorAll('[data-throwing-week="true"]'));
      if (!(weekdayEl instanceof HTMLElement) || weekEls.length === 0) throw new Error('Throwing calendar render target not found.');

      const weekdayCanvas = await renderCanvas(weekdayEl);
      const weekdayImage = weekdayCanvas.toDataURL('image/png');
      const weekdayHeight = (weekdayCanvas.height * targetWidth) / weekdayCanvas.width;

      const weekBlocks: Array<{ image: string; height: number }> = [];
      for (const weekEl of weekEls) {
        if (!(weekEl instanceof HTMLElement)) continue;
        const canvas = await renderCanvas(weekEl);
        weekBlocks.push({
          image: canvas.toDataURL('image/png'),
          height: (canvas.height * targetWidth) / canvas.width,
        });
      }

      let pageIndex = 0;
      let cursorY = margin;
      const startNewPage = () => {
        if (pageIndex > 0) pdf.addPage();
        paintPageBackground();
        drawCenteredHeader();
        cursorY = margin + headerBlockHeight;
        pdf.addImage(weekdayImage, 'PNG', margin, cursorY, targetWidth, weekdayHeight);
        cursorY += weekdayHeight + sectionGap;
        pageIndex += 1;
      };

      startNewPage();
      for (const block of weekBlocks) {
        if (cursorY + block.height > pageHeight - margin) {
          startNewPage();
        }
        pdf.addImage(block.image, 'PNG', margin, cursorY, targetWidth, block.height);
        cursorY += block.height;
      }
      const monthName =
        throwingBuilderMode === 'weeks'
          ? `week-template-${Math.max(THROWING_MIN_WEEKS, throwingTemplateWeekCount)}`
          : fromIsoDate(anchorDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).replaceAll(' ', '-');
      pdf.save(`throwing-calendar-${monthName}.pdf`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to generate PDF.');
    }
  };

  const assignWorkout = async (dayDate: string, workoutId: number) => {
    if (!playerId) return;
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/schedule/assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, dayDate, workoutId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to assign workout.');
      await loadItems();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign workout.');
    }
  };

  const assignCycleWorkout = async (cycleSlot: CycleSlotKey, workoutId: number) => {
    if (!playerId) return;
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/schedule/cycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, workoutId, cycleSlot }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to assign cycle workout.');
      await loadItems();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign cycle workout.');
    }
  };

  const moveCycleItem = async (itemId: number, cycleSlot: CycleSlotKey) => {
    if (!playerId) return;
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/schedule/cycle', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, itemId, cycleSlot }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to move cycle workout.');
      await loadItems();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Failed to move cycle workout.');
    }
  };

  const reorderDayItems = async (dayDate: string, orderedItemIds: number[]) => {
    setItems((prev) => {
      const dayMap = new Map<number, ProgramItemRow>();
      for (const item of prev.filter((item) => item.dayDate === dayDate)) dayMap.set(item.itemId, item);
      const daySorted = orderedItemIds.map((id) => dayMap.get(id)).filter((item): item is ProgramItemRow => Boolean(item));
      const other = prev.filter((item) => item.dayDate !== dayDate);
      return [...other, ...daySorted].sort((a, b) => (a.dayDate === b.dayDate ? 0 : a.dayDate.localeCompare(b.dayDate)));
    });

    const response = await fetchWithTimeout('/api/admin/schedule/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, dayDate, orderedItemIds }),
    });
    if (!response.ok) {
      await loadItems();
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? 'Failed to reorder day items.');
    }
  };

  const onDayDrop = async (event: React.DragEvent<HTMLElement>, dayDate: string) => {
    event.preventDefault();
    const templateId = Number(event.dataTransfer.getData('templateId'));
    if (Number.isFinite(templateId) && templateId > 0) {
      await applyTemplate(templateId, dayDate);
      return;
    }

    const scheduleItemId = Number(event.dataTransfer.getData('scheduleItemId'));
    const sourceDate = event.dataTransfer.getData('scheduleItemDay');
    if (Number.isFinite(scheduleItemId) && scheduleItemId > 0) {
      if (sourceDate === dayDate) return;
      setError('');
      try {
        const response = await fetchWithTimeout('/api/admin/schedule/move', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            playerId,
            itemId: scheduleItemId,
            targetDate: dayDate,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to move schedule item.');
        await loadItems();
      } catch (moveError) {
        setError(moveError instanceof Error ? moveError.message : 'Failed to move schedule item.');
      }
      return;
    }

    const workoutId = Number(event.dataTransfer.getData('workoutId'));
    if (!Number.isFinite(workoutId) || workoutId <= 0) return;
    await assignWorkout(dayDate, workoutId);
  };

  const serializeCopiedItems = (dayDate: string): CopiedAssignment[] => {
    const dayItems = itemsByDate.get(dayDate) ?? [];
    const copied: CopiedAssignment[] = [];
    for (const item of dayItems) {
      if (item.itemType === 'workout') {
        if (!item.workoutId) continue;
        copied.push({
          assignmentType: 'workout',
          workoutId: item.workoutId,
          prescribedSets: item.prescribedSets ?? '',
          prescribedReps: item.prescribedReps ?? '',
          prescribedLoad: item.prescribedLoad ?? '',
          prescribedNotes: item.prescribedNotes ?? '',
        });
        continue;
      }
      if (!item.exerciseId) continue;
      copied.push({
        assignmentType: 'exercise',
        exerciseId: item.exerciseId,
        prescribedSets: item.prescribedSets ?? '',
        prescribedReps: item.prescribedReps ?? '',
        prescribedLoad: item.prescribedLoad ?? '',
        prescribedNotes: item.prescribedNotes ?? '',
      });
    }
    return copied;
  };

  const copyDay = (dayDate: string) => {
    setCopiedPlan({
      mode: 'day',
      sourceDate: dayDate,
      days: [{ offset: 0, items: serializeCopiedItems(dayDate) }],
    });
    setMenu(null);
  };

  const copyWeekFromDay = (dayDate: string) => {
    const weekDayIndex = fromIsoDate(dayDate).getUTCDay();
    const dayCount = 7 - weekDayIndex;
    const days = Array.from({ length: dayCount }, (_, idx) => {
      const sourceDate = addDays(dayDate, idx);
      return { offset: idx, items: serializeCopiedItems(sourceDate) };
    });
    setCopiedPlan({
      mode: 'week',
      sourceDate: dayDate,
      days,
    });
    setMenu(null);
  };

  const pasteCopiedPlan = async (targetDate: string) => {
    if (!copiedPlan || !playerId) return;
    setMenu(null);
    setError('');
    try {
      const dayPlans = copiedPlan.days.map((day) => ({
        dayDate: addDays(targetDate, day.offset),
        items: day.items,
      }));
      const response = await fetchWithTimeout('/api/admin/schedule/copy-paste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          programName: 'Current Program',
          dayPlans,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to paste copied schedule.');
      await loadItems();
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : 'Failed to paste copied schedule.');
    }
  };

  const deleteCycleItem = async (itemId: number) => {
    if (!playerId) return;
    setError('');
    const response = await fetchWithTimeout('/api/admin/schedule/cycle', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, itemId }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Failed to delete cycle workout.');
    await loadItems();
  };

  const serializeCycleSlot = (cycleSlot: CycleSlotKey): Array<{ workoutId: number }> => {
    return cycleItemsBySlot[cycleSlot]
      .map((item) => Number(item.workoutId ?? 0))
      .filter((workoutId) => Number.isFinite(workoutId) && workoutId > 0)
      .map((workoutId) => ({ workoutId }));
  };

  const copyCycleSlot = (cycleSlot: CycleSlotKey) => {
    setCopiedCycle({
      sourceSlot: cycleSlot,
      items: serializeCycleSlot(cycleSlot),
    });
    setCycleMenu(null);
  };

  const deleteCycleSlotItems = async (cycleSlot: CycleSlotKey) => {
    if (!playerId) return;
    const slotItems = cycleItemsBySlot[cycleSlot];
    for (const item of slotItems) {
      const response = await fetchWithTimeout('/api/admin/schedule/cycle', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, itemId: item.itemId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete cycle workout.');
    }
  };

  const clearCycleSlot = async (cycleSlot: CycleSlotKey) => {
    if (!playerId) return;
    setError('');
    try {
      await deleteCycleSlotItems(cycleSlot);
      await loadItems();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete cycle workouts.');
    }
  };

  const pasteCycleSlot = async (targetSlot: CycleSlotKey) => {
    if (!playerId || !copiedCycle) return;
    setCycleMenu(null);
    setError('');
    try {
      await deleteCycleSlotItems(targetSlot);
      for (const item of copiedCycle.items) {
        const response = await fetchWithTimeout('/api/admin/schedule/cycle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId, cycleSlot: targetSlot, workoutId: item.workoutId }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to paste cycle workout.');
      }
      await loadItems();
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : 'Failed to paste cycle workouts.');
    }
  };

  const copyThrowingDayMonth = (date: string) => {
    const entry = throwingByDate[date] ?? emptyThrowingEntry;
    setCopiedThrowing({
      mode: 'day',
      days: [{ offset: 0, entry: { ...entry } }],
    });
    setThrowingMenu(null);
  };

  const copyThrowingWeekMonth = (date: string) => {
    const weekDayIndex = fromIsoDate(date).getUTCDay();
    const dayCount = 7 - weekDayIndex;
    const days = Array.from({ length: dayCount }, (_, idx) => {
      const sourceDate = addDays(date, idx);
      return { offset: idx, entry: { ...(throwingByDate[sourceDate] ?? emptyThrowingEntry) } };
    });
    setCopiedThrowing({
      mode: 'week',
      days,
      weekNote: String(throwingWeekNotes[startOfWeek(date)] ?? ''),
    });
    setThrowingMenu(null);
  };

  const pasteThrowingMonth = (targetDate: string) => {
    if (!copiedThrowing) return;
    setThrowingByDate((prev) => {
      const next = { ...prev };
      copiedThrowing.days.forEach((day) => {
        next[addDays(targetDate, day.offset)] = { ...day.entry };
      });
      return next;
    });
    if (copiedThrowing.mode === 'week' && copiedThrowing.weekNote) {
      setThrowingWeekNotes((prev) => ({
        ...prev,
        [startOfWeek(targetDate)]: copiedThrowing.weekNote ?? '',
      }));
    }
    setThrowingMenu(null);
  };

  const clearThrowingDayMonth = (date: string) => {
    setThrowingByDate((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
    setThrowingMenu(null);
  };

  const clearThrowingWeekMonth = (date: string) => {
    const weekStart = startOfWeek(date);
    setThrowingByDate((prev) => {
      const next = { ...prev };
      for (let idx = 0; idx < 7; idx += 1) delete next[addDays(weekStart, idx)];
      return next;
    });
    setThrowingWeekNotes((prev) => {
      const next = { ...prev };
      delete next[weekStart];
      return next;
    });
    setThrowingMenu(null);
  };

  const copyThrowingDayTemplate = (weekIndex: number, dayIndex: number) => {
    const key = getThrowingTemplateCellKey(weekIndex, dayIndex);
    const entry = throwingTemplateByCell[key] ?? emptyThrowingEntry;
    setCopiedThrowing({
      mode: 'day',
      days: [{ offset: 0, entry: { ...entry } }],
    });
    setThrowingMenu(null);
  };

  const copyThrowingWeekTemplate = (weekIndex: number, dayIndex: number) => {
    const dayCount = 7 - dayIndex;
    const days = Array.from({ length: dayCount }, (_, idx) => {
      const key = getThrowingTemplateCellKey(weekIndex, dayIndex + idx);
      return { offset: idx, entry: { ...(throwingTemplateByCell[key] ?? emptyThrowingEntry) } };
    });
    setCopiedThrowing({
      mode: 'week',
      days,
      weekNote: String(throwingTemplateWeekNotes[`week-${weekIndex + 1}`] ?? ''),
    });
    setThrowingMenu(null);
  };

  const pasteThrowingTemplate = (weekIndex: number, dayIndex: number) => {
    if (!copiedThrowing) return;
    setThrowingTemplateByCell((prev) => {
      const next = { ...prev };
      copiedThrowing.days.forEach((day) => {
        const targetDayIndex = dayIndex + day.offset;
        if (targetDayIndex > 6) return;
        next[getThrowingTemplateCellKey(weekIndex, targetDayIndex)] = { ...day.entry };
      });
      return next;
    });
    if (copiedThrowing.mode === 'week' && copiedThrowing.weekNote) {
      setThrowingTemplateWeekNotes((prev) => ({
        ...prev,
        [`week-${weekIndex + 1}`]: copiedThrowing.weekNote ?? '',
      }));
    }
    setThrowingMenu(null);
  };

  const clearThrowingDayTemplate = (weekIndex: number, dayIndex: number) => {
    setThrowingTemplateByCell((prev) => {
      const next = { ...prev };
      delete next[getThrowingTemplateCellKey(weekIndex, dayIndex)];
      return next;
    });
    setThrowingMenu(null);
  };

  const clearThrowingWeekTemplate = (weekIndex: number, dayIndex: number) => {
    setThrowingTemplateByCell((prev) => {
      const next = { ...prev };
      for (let idx = 0; idx < 7; idx += 1) delete next[getThrowingTemplateCellKey(weekIndex, idx)];
      return next;
    });
    setThrowingTemplateWeekNotes((prev) => {
      const next = { ...prev };
      delete next[`week-${weekIndex + 1}`];
      return next;
    });
    setThrowingMenu(null);
  };

  const throwingInputBaseStyle: CSSProperties = {
    minHeight: '36px',
    padding: '0.42rem 0.55rem',
    textAlign: 'left',
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
  };

  const throwingNotesStyle: CSSProperties = {
    width: '100%',
    height: 'calc((36px * 4) + (0.28rem * 3))',
    minHeight: 'calc((36px * 4) + (0.28rem * 3))',
    resize: 'none',
  };

  const throwingLabelStyle: CSSProperties = {
    fontSize: '0.78rem',
    fontWeight: 700,
    color: 'var(--text-main)',
    minWidth: '74px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };

  const throwingRowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '78px 1fr',
    alignItems: 'center',
    gap: '0.32rem',
    minWidth: 0,
  };

  const embedVideoUrl = (raw: string): string => {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname.includes('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
        const shortMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/i);
        if (shortMatch?.[1]) return `https://www.youtube.com/embed/${shortMatch[1]}`;
      }
      if (parsed.hostname.includes('youtu.be')) {
        const videoId = parsed.pathname.replace('/', '').trim();
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      }
      if (parsed.hostname.includes('vimeo.com')) {
        const id = parsed.pathname.split('/').filter(Boolean)[0];
        if (id) return `https://player.vimeo.com/video/${id}`;
      }
      return raw;
    } catch {
      return raw;
    }
  };

  const parseIntensityValue = (raw: string): number | null => {
    const match = String(raw ?? '').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  const getThrowingIntensityTone = (entry: ThrowingDayEntry): 'low' | 'medium' | 'high' | '' => {
    const intensity = parseIntensityValue(entry.intensity);
    if (intensity == null) return '';
    if (intensity <= 60) return 'low';
    if (intensity >= 65 && intensity <= 85) return 'medium';
    if (intensity >= 90) return 'high';
    return '';
  };

  const getThrowingCellHighlightStyle = (entry: ThrowingDayEntry): CSSProperties => {
    const intensity = parseIntensityValue(entry.intensity);
    if (intensity == null) return {};
    if (intensity <= 60) {
      return {
        background: 'rgba(153, 27, 27, 0.30)',
        boxShadow: 'inset 0 0 0 1px rgba(239, 68, 68, 0.55)',
      };
    }
    if (intensity >= 65 && intensity <= 85) {
      return {
        background: 'rgba(202, 138, 4, 0.28)',
        boxShadow: 'inset 0 0 0 1px rgba(250, 204, 21, 0.55)',
      };
    }
    if (intensity >= 90) {
      return {
        background: 'rgba(21, 128, 61, 0.30)',
        boxShadow: 'inset 0 0 0 1px rgba(74, 222, 128, 0.55)',
      };
    }
    return {};
  };

  const deleteCalendarItem = async (itemId: number) => {
    if (!playerId) return;
    setError('');
    const response = await fetchWithTimeout('/api/admin/schedule/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, itemId, mode: 'item' }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Failed to delete schedule workout.');
    await loadItems();
  };

  const bulkDeleteItems = async () => {
    if (!playerId || selectedItemIds.size === 0) return;
    setError('');
    try {
      const selectedItems = items.filter((item) => selectedItemIds.has(item.itemId));
      await Promise.all(selectedItems.map((item) =>
        fetchWithTimeout(item.scheduleType === 'cycle' ? '/api/admin/schedule/cycle' : '/api/admin/schedule/delete', {
          method: item.scheduleType === 'cycle' ? 'DELETE' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId, itemId: item.itemId, mode: 'item' }),
        }).then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) throw new Error(payload.error ?? 'Failed to delete item.');
        })
      ));
      setSelectedItemIds(new Set());
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete items.');
    }
  };

  const replaceCycleItem = async (item: ProgramItemRow, workoutId: number) => {
    if (!item.cycleSlot) throw new Error('Cycle slot missing for selected workout.');
    const deleteResponse = await fetchWithTimeout('/api/admin/schedule/cycle', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, itemId: item.itemId }),
    });
    const deletePayload = (await deleteResponse.json().catch(() => ({}))) as { error?: string };
    if (!deleteResponse.ok) throw new Error(deletePayload.error ?? 'Failed to delete cycle item.');

    const assignResponse = await fetchWithTimeout('/api/admin/schedule/cycle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, cycleSlot: item.cycleSlot, workoutId }),
    });
    const assignPayload = (await assignResponse.json().catch(() => ({}))) as { error?: string };
    if (!assignResponse.ok) throw new Error(assignPayload.error ?? 'Failed to assign replacement.');
  };

  const bulkReplaceItems = async (workoutId: number) => {
    if (!playerId || selectedItemIds.size === 0) return;
    setError('');
    try {
      const selectedItems = items.filter((item) => selectedItemIds.has(item.itemId));
      const selectedCalendarItems = selectedItems.filter((item) => item.scheduleType !== 'cycle');
      const selectedCycleItems = selectedItems.filter((item) => item.scheduleType === 'cycle');

      for (const item of selectedCycleItems) {
        await replaceCycleItem(item, workoutId);
      }

      const selectedByDay = new Map<string, ProgramItemRow[]>();
      const orderedIdsByDay = new Map<string, number[]>();

      for (const item of selectedCalendarItems) {
        selectedByDay.set(item.dayDate, [...(selectedByDay.get(item.dayDate) ?? []), item]);
      }
      for (const dayDate of selectedByDay.keys()) {
        orderedIdsByDay.set(
          dayDate,
          items
            .filter((candidate) => candidate.dayDate === dayDate)
            .map((candidate) => candidate.itemId)
        );
      }

      for (const [dayDate, daySelectedItems] of selectedByDay.entries()) {
        let orderedItemIds = orderedIdsByDay.get(dayDate) ?? [];

        for (const item of daySelectedItems) {
          const deleteResponse = await fetchWithTimeout('/api/admin/schedule/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerId, itemId: item.itemId, mode: 'item' }),
          });
          const deletePayload = (await deleteResponse.json().catch(() => ({}))) as { error?: string };
          if (!deleteResponse.ok) throw new Error(deletePayload.error ?? 'Failed to delete item.');

          const assignResponse = await fetchWithTimeout('/api/admin/schedule/assignments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerId, dayDate, workoutId }),
          });
          const assignPayload = (await assignResponse.json().catch(() => ({}))) as { error?: string; itemId?: number };
          if (!assignResponse.ok) throw new Error(assignPayload.error ?? 'Failed to assign replacement.');
          const replacementItemId = Number(assignPayload.itemId ?? 0);
          if (!Number.isFinite(replacementItemId) || replacementItemId <= 0) {
            throw new Error('Replacement was created without an item id.');
          }
          orderedItemIds = orderedItemIds.map((id) => (id === item.itemId ? replacementItemId : id));
        }

        const reorderResponse = await fetchWithTimeout('/api/admin/schedule/reorder', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId, dayDate, orderedItemIds }),
        });
        const reorderPayload = (await reorderResponse.json().catch(() => ({}))) as { error?: string };
        if (!reorderResponse.ok) throw new Error(reorderPayload.error ?? 'Failed to preserve workout order.');
      }
      setSelectedItemIds(new Set());
      setBulkReplaceOpen(false);
      setBulkReplaceQuery('');
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to replace items.');
    }
  };

  const clearCalendarDay = async (dayDate: string) => {
    if (!playerId) return;
    setError('');
    try {
      const response = await fetchWithTimeout('/api/admin/schedule/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, dayDate, mode: 'day' }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete day workouts.');
      await loadItems();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete day workouts.');
    }
  };

  useEffect(() => {
    if (!menu && !throwingMenu && !cycleMenu) return;
    const onPointerDown = () => setMenu(null);
    const onThrowingPointerDown = () => setThrowingMenu(null);
    const onCyclePointerDown = () => setCycleMenu(null);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerdown', onThrowingPointerDown);
    window.addEventListener('pointerdown', onCyclePointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerdown', onThrowingPointerDown);
      window.removeEventListener('pointerdown', onCyclePointerDown);
    };
  }, [menu, throwingMenu, cycleMenu]);

  const onItemDrop = async (event: React.DragEvent<HTMLElement>, dayDate: string, targetItemId: number) => {
    event.preventDefault();
    const sourceItemId = Number(event.dataTransfer.getData('scheduleItemId'));
    const sourceDate = event.dataTransfer.getData('scheduleItemDay');
    if (!Number.isFinite(sourceItemId) || sourceItemId <= 0) return;
    if (sourceDate !== dayDate) return;
    const dayItems = (itemsByDate.get(dayDate) ?? []).map((item) => item.itemId);
    const from = dayItems.indexOf(sourceItemId);
    const to = dayItems.indexOf(targetItemId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...dayItems];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await reorderDayItems(dayDate, next);
  };

  const workoutById = useMemo(() => {
    const map = new Map<number, WorkoutChoice>();
    for (const workout of workouts) map.set(workout.id, workout);
    return map;
  }, [workouts]);

  const cycleItemsBySlot = useMemo(() => {
    const map: Record<'medium' | 'high' | 'low' | 'mobility' | 's_and_c', ProgramItemRow[]> = {
      medium: [],
      high: [],
      low: [],
      mobility: [],
      s_and_c: [],
    };
    for (const item of items) {
      if (item.scheduleType !== 'cycle') continue;
      const slot = item.cycleSlot;
      if (!slot) continue;
      map[slot].push(item);
    }
    return map;
  }, [items]);

  const onCycleDrop = async (
    event: React.DragEvent<HTMLElement>,
    cycleSlot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c'
  ) => {
    event.preventDefault();
    const cycleItemId = Number(event.dataTransfer.getData('cycleItemId'));
    if (Number.isFinite(cycleItemId) && cycleItemId > 0) {
      const sourceSlot = event.dataTransfer.getData('cycleItemSlot');
      if (sourceSlot === cycleSlot) return;
      await moveCycleItem(cycleItemId, cycleSlot);
      return;
    }

    const workoutId = Number(event.dataTransfer.getData('workoutId'));
    if (!Number.isFinite(workoutId) || workoutId <= 0) return;
    await assignCycleWorkout(cycleSlot, workoutId);
  };

  const onTemplateDayDrop = (event: React.DragEvent<HTMLElement>, dayOffset: number) => {
    event.preventDefault();
    const sourceOffsetRaw = event.dataTransfer.getData('templateDayOffset');
    const sourceIndexRaw = event.dataTransfer.getData('templateDayItemIndex');
    const sourceOffset = sourceOffsetRaw === '' ? Number.NaN : Number(sourceOffsetRaw);
    const sourceIndex = sourceIndexRaw === '' ? Number.NaN : Number(sourceIndexRaw);
    if (
      Number.isFinite(sourceOffset) &&
      sourceOffset >= 0 &&
      Number.isFinite(sourceIndex) &&
      sourceIndex >= 0
    ) {
      if (sourceOffset === dayOffset) return;
      setTemplateDayItems((current) => {
        const sourceList = [...(current[sourceOffset] ?? [])];
        if (sourceIndex >= sourceList.length) return current;
        const [moved] = sourceList.splice(sourceIndex, 1);
        const targetList = [...(current[dayOffset] ?? []), moved];
        const next: Record<number, TemplateDraftItem[]> = { ...current, [dayOffset]: targetList };
        if (sourceList.length > 0) next[sourceOffset] = sourceList;
        else delete next[sourceOffset];
        return next;
      });
      return;
    }

    const workoutId = Number(event.dataTransfer.getData('workoutId'));
    if (!Number.isFinite(workoutId) || workoutId <= 0) return;
    const workout = workoutById.get(workoutId);
    if (!workout) return;
    setTemplateDayItems((current) => ({
      ...current,
      [dayOffset]: [
        ...(current[dayOffset] ?? []),
        {
          workoutId: workout.id,
          workoutName: workout.name,
          workoutCategory: workout.category ?? null,
        },
      ],
    }));
  };

  const onTemplateItemDrop = (
    event: React.DragEvent<HTMLElement>,
    dayOffset: number,
    targetIndex: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceOffsetRaw = event.dataTransfer.getData('templateDayOffset');
    const sourceIndexRaw = event.dataTransfer.getData('templateDayItemIndex');
    const sourceOffset = sourceOffsetRaw === '' ? Number.NaN : Number(sourceOffsetRaw);
    const sourceIndex = sourceIndexRaw === '' ? Number.NaN : Number(sourceIndexRaw);
    if (!Number.isFinite(sourceOffset) || !Number.isFinite(sourceIndex)) return;
    if (sourceOffset < 0 || sourceIndex < 0) return;
    if (sourceOffset !== dayOffset) return;
    if (sourceIndex === targetIndex) return;

    setTemplateDayItems((current) => {
      const list = [...(current[dayOffset] ?? [])];
      if (sourceIndex >= list.length || targetIndex < 0 || targetIndex >= list.length) return current;
      const [moved] = list.splice(sourceIndex, 1);
      list.splice(targetIndex, 0, moved);
      return { ...current, [dayOffset]: list };
    });
  };

  const removeTemplateDayItem = (dayOffset: number, itemIndex: number) => {
    setTemplateDayItems((current) => {
      const list = [...(current[dayOffset] ?? [])];
      if (itemIndex < 0 || itemIndex >= list.length) return current;
      list.splice(itemIndex, 1);
      const next = { ...current };
      if (list.length > 0) next[dayOffset] = list;
      else delete next[dayOffset];
      return next;
    });
  };

  const renderDayCell = (dayDate: string, compact: boolean, monthStart?: string, showDayLabel = false) => {
    const dayItems = itemsByDate.get(dayDate) ?? [];
    const isOutsideMonth = monthStart ? !dayDate.startsWith(monthStart.slice(0, 7)) : false;
    const today = isToday(dayDate);
    return (
      <article
        key={dayDate}
        className={`portal-schedule-day${compact ? ' is-compact' : ''}${view === 'week' ? ' is-week' : ''}${isOutsideMonth ? ' is-outside' : ''}${today ? ' is-today' : ''}`}
        style={{
          minHeight: view === 'week' ? '128px' : '280px',
          borderRadius: 0,
          borderTop: 0,
          borderLeft: 0,
          borderRight: '1px solid var(--calendar-grid-border, var(--border))',
          borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
          display: view === 'week' ? 'flex' : undefined,
          flexDirection: view === 'week' ? 'column' : undefined,
          justifyContent: view === 'week' ? 'flex-start' : undefined,
          gap: view === 'week' ? '0.25rem' : undefined,
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void onDayDrop(event, dayDate)}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('.portal-schedule-item')) return;
          setMenu({ dayDate, x: event.clientX, y: event.clientY });
        }}
      >
        <header>
          <strong>
            <span className="portal-schedule-day-num">{dayNumber(dayDate)}</span>
            {showDayLabel && <span className="portal-schedule-day-label">{shortDayLabel(dayDate)}</span>}
          </strong>
        </header>
        <div className="portal-schedule-day-body">
          {dayItems.map((item) => (
            <div key={item.itemId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {builderMode === 'schedule' && (view === 'day' || view === 'week' || view === 'month') ? (
                <input
                  type="checkbox"
                  checked={selectedItemIds.has(item.itemId)}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSelectedItemIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(item.itemId);
                      else next.delete(item.itemId);
                      return next;
                    });
                  }}
                  style={{ flexShrink: 0, accentColor: '#c8102e', cursor: 'pointer' }}
                />
              ) : null}
              <button
                type="button"
                className="portal-schedule-item"
                title={item.itemName}
                style={{
                  flex: 1,
                  display: 'block',
                  width: '100%',
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  color: 'var(--text-main)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderRadius: '6px',
                  padding: '0.1rem 0.34rem',
                  minHeight: '22px',
                  lineHeight: 1.1,
                  overflow: 'hidden',
                  ...categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout'),
                  ...(selectedItemIds.has(item.itemId) ? { borderColor: '#c8102e' } : {}),
                }}
                draggable={!selectedItemIds.has(item.itemId)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('scheduleItemId', String(item.itemId));
                  event.dataTransfer.setData('scheduleItemDay', item.dayDate);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void onItemDrop(event, dayDate, item.itemId)}
                onClick={() => {
                  if (selectedItemIds.size > 0) {
                    setSelectedItemIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.itemId)) next.delete(item.itemId);
                      else next.add(item.itemId);
                      return next;
                    });
                    return;
                  }
                  const linkTarget = getCalendarLinkTarget(item);
                  if (linkTarget === 'throwing') {
                    setAnchorDate(item.dayDate);
                    setView('throwing');
                    setThrowingBuilderMode('month');
                    setThrowingCalendarView('day');
                    return;
                  }
                  if (linkTarget === 'bullpens') {
                    setView('bullpens');
                    return;
                  }
                  if (linkTarget === 'velocity') {
                    setView('velocity');
                    return;
                  }
                  if (linkTarget === 'drills') {
                    setView('drills');
                    return;
                  }
                  setSelectedItem(item);
                }}
              >
                <strong style={{ lineHeight: 1.1 }}>{item.itemName}</strong>
              </button>
            </div>
          ))}
        </div>
      </article>
    );
  };

  const renderEmptyMonthCell = (key: string) => (
    <article
      key={key}
      className="portal-schedule-day portal-schedule-day-empty"
      style={{
        minHeight: '280px',
        borderRadius: 0,
        borderTop: 0,
        borderLeft: 0,
        borderRight: '1px solid var(--calendar-grid-border, var(--border))',
        borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
      }}
      aria-hidden="true"
    />
  );

  if (players.length === 0) {
    return <p className="portal-muted-text">Create a client first before scheduling workouts.</p>;
  }

  const renderThrowingDay = (date: string, key: string) => {
    const entry = throwingByDate[date] ?? { intensity: '', distance: '', throwsText: '', drills: '', bullpen: '' };
    const setField = (field: keyof ThrowingDayEntry, value: string) => {
      setThrowingByDate((prev) => ({
        ...prev,
        [date]: { ...(prev[date] ?? { intensity: '', distance: '', throwsText: '', drills: '', bullpen: '' }), [field]: value },
      }));
    };
    return (
      <article
        key={date}
        className="portal-schedule-day portal-throwing-cell"
        data-throwing-intensity-tone={getThrowingIntensityTone(entry) || undefined}
        style={{
          minHeight: '182px',
          aspectRatio: 'auto',
          borderRadius: 0,
          borderTop: 0,
          borderLeft: 0,
          borderRight: '1px solid var(--calendar-grid-border, var(--border))',
          borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
          boxShadow: throwingApplyStartDate === date ? 'inset 0 0 0 1px rgba(220, 38, 38, 0.5)' : undefined,
          cursor: 'pointer',
          ...getThrowingCellHighlightStyle(entry),
        }}
        onClick={() => setThrowingApplyStartDate(date)}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('input, textarea')) return;
          if (!(view === 'throwing' && throwingBuilderMode === 'month')) return;
          setThrowingMenu({ mode: 'month', date, x: event.clientX, y: event.clientY });
        }}
      >
        <div className="portal-schedule-day-head">
          <span className="portal-schedule-day-num">{dayNumber(date)}</span>
        </div>
        <div className="portal-schedule-day-body" style={{ display: 'grid', gap: '0.28rem' }}>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Intensity:</span>
            <input className="portal-throwing-field" value={String(entry.intensity ?? '')} onChange={(event) => setField('intensity', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Distance:</span>
            <input className="portal-throwing-field" value={String(entry.distance ?? '')} onChange={(event) => setField('distance', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Throws:</span>
            <input className="portal-throwing-field" value={String(entry.throwsText ?? '')} onChange={(event) => setField('throwsText', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Drills:</span>
            <input className="portal-throwing-field" value={String(entry.drills ?? '')} onChange={(event) => setField('drills', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Bullpen:</span>
            <input className="portal-throwing-field" value={String(entry.bullpen ?? '')} onChange={(event) => setField('bullpen', event.target.value)} style={throwingInputBaseStyle} />
          </div>
        </div>
      </article>
    );
  };

  const isVelocityView = view === 'velocity';
  const activeCurrent = isVelocityView ? velocityCurrent : bullpenCurrent;
  const activeTemplates = isVelocityView ? velocityTemplates : bullpenTemplates;
  const activeSelectedTemplateId = isVelocityView ? selectedVelocityTemplateId : selectedBullpenTemplateId;
  const activeVisibleTemplateIds = isVelocityView ? visibleVelocityTemplateIds : visibleBullpenTemplateIds;
  const activeSavedTemplateSelected = Boolean(activeSelectedTemplateId && activeTemplates.some((template) => template.id === activeSelectedTemplateId));

  const saveThrowingTemplate = () => {
    const name = throwingTemplateName.trim();
    if (!name) {
      setError('Template name is required.');
      return;
    }
    const normalizedWeekCount = Math.max(THROWING_MIN_WEEKS, Math.min(THROWING_MAX_WEEKS, throwingTemplateWeekCount || 4));
    const nowIso = new Date().toISOString();
    const nextId = selectedThrowingTemplateId || `thr-${Date.now()}`;
    const nextTemplate: ThrowingTemplate = {
      id: nextId,
      name,
      weekCount: normalizedWeekCount,
      byCell: normalizeThrowingTemplateCells(throwingTemplateByCell),
      weekNotes: throwingTemplateWeekNotes,
      updatedAt: nowIso,
    };
    setThrowingTemplates((prev) => {
      const index = prev.findIndex((template) => template.id === nextId);
      if (index < 0) return [nextTemplate, ...prev];
      const copy = [...prev];
      copy[index] = nextTemplate;
      return copy;
    });
    setSelectedThrowingTemplateId(nextId);
    setError('');
  };

  const selectThrowingTemplate = (templateId: string) => {
    if (!templateId) {
      setSelectedThrowingTemplateId('');
      setThrowingTemplateName('');
      setThrowingTemplateWeekCount(4);
      setThrowingTemplateByCell({});
      setThrowingTemplateWeekNotes({});
      return;
    }
    const found = throwingTemplates.find((template) => template.id === templateId);
    if (!found) return;
    setSelectedThrowingTemplateId(found.id);
    setThrowingTemplateName(found.name);
    setThrowingTemplateWeekCount(found.weekCount);
    setThrowingTemplateByCell(normalizeThrowingTemplateCells(found.byCell));
    setThrowingTemplateWeekNotes(found.weekNotes ?? {});
  };

  const deleteThrowingTemplate = () => {
    if (!selectedThrowingTemplateId) return;
    const confirmed = window.confirm('Delete this throwing template?');
    if (!confirmed) return;
    setThrowingTemplates((prev) => prev.filter((template) => template.id !== selectedThrowingTemplateId));
    setSelectedThrowingTemplateId('');
    setThrowingTemplateName('');
    setThrowingTemplateWeekCount(4);
    setThrowingTemplateByCell({});
    setThrowingTemplateWeekNotes({});
    setError('');
  };

  const applyWeekBuilderTemplateToMonth = () => {
    const template = throwingTemplates.find((item) => item.id === throwingApplyTemplateId);
    if (!template) {
      setError('Select a saved Week Builder template.');
      return;
    }
    if (!throwingApplyStartDate) {
      setError('Click a calendar day to set the start day.');
      return;
    }

    const totalWeeks = Math.max(THROWING_MIN_WEEKS, Math.min(THROWING_MAX_WEEKS, Number(template.weekCount ?? 0) || THROWING_MIN_WEEKS));
    const nextByDate: Record<string, ThrowingDayEntry> = { ...throwingByDate };
    const nextWeekNotes: Record<string, string> = { ...throwingWeekNotes };

    for (let weekIdx = 0; weekIdx < totalWeeks; weekIdx += 1) {
      for (let dayIdx = 0; dayIdx < 7; dayIdx += 1) {
        const sourceKey = getThrowingTemplateCellKey(weekIdx, dayIdx);
        const source = template.byCell?.[sourceKey];
        if (!hasThrowingEntry(source)) continue;
        const targetDate = addDays(throwingApplyStartDate, weekIdx * 7 + dayIdx);
        nextByDate[targetDate] = {
          intensity: String(source?.intensity ?? ''),
          distance: String(source?.distance ?? ''),
          throwsText: String(source?.throwsText ?? ''),
          drills: String(source?.drills ?? ''),
          bullpen: String(source?.bullpen ?? ''),
        };
      }
      const note = String(template.weekNotes?.[`week-${weekIdx + 1}`] ?? '').trim();
      if (note) {
        const targetWeekStart = startOfWeek(addDays(throwingApplyStartDate, weekIdx * 7));
        nextWeekNotes[targetWeekStart] = note;
      }
    }

    setThrowingByDate(nextByDate);
    setThrowingWeekNotes(nextWeekNotes);
    setError('');
  };

  const renderThrowingTemplateDay = (weekIndex: number, dayIndex: number) => {
    const cellKey = getThrowingTemplateCellKey(weekIndex, dayIndex);
    const entry = normalizeThrowingEntry(throwingTemplateByCell[cellKey]);
    const setField = (field: keyof ThrowingDayEntry, value: string) => {
      setThrowingTemplateByCell((prev) => ({
        ...prev,
        [cellKey]: { ...normalizeThrowingEntry(prev[cellKey]), [field]: value },
      }));
    };
    return (
      <article
        key={`throwing-template-${cellKey}`}
        className="portal-schedule-day portal-throwing-cell"
        data-throwing-intensity-tone={getThrowingIntensityTone(entry) || undefined}
        style={{
          minHeight: '182px',
          aspectRatio: 'auto',
          borderRadius: 0,
          borderTop: 0,
          borderLeft: 0,
          borderRight: '1px solid var(--calendar-grid-border, var(--border))',
          borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
          ...getThrowingCellHighlightStyle(entry),
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('input, textarea')) return;
          if (!(view === 'throwing' && throwingBuilderMode === 'weeks')) return;
          setThrowingMenu({ mode: 'weeks', weekIndex, dayIndex, x: event.clientX, y: event.clientY });
        }}
      >
        <div className="portal-schedule-day-head">
          <span className="portal-schedule-day-num" />
        </div>
        <div className="portal-schedule-day-body" style={{ display: 'grid', gap: '0.28rem' }}>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Intensity:</span>
            <input className="portal-throwing-field" value={String(entry.intensity ?? '')} onChange={(event) => setField('intensity', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Distance:</span>
            <input className="portal-throwing-field" value={String(entry.distance ?? '')} onChange={(event) => setField('distance', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Throws:</span>
            <input className="portal-throwing-field" value={String(entry.throwsText ?? '')} onChange={(event) => setField('throwsText', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Drills:</span>
            <input className="portal-throwing-field" value={String(entry.drills ?? '')} onChange={(event) => setField('drills', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Bullpen:</span>
            <input className="portal-throwing-field" value={String(entry.bullpen ?? '')} onChange={(event) => setField('bullpen', event.target.value)} style={throwingInputBaseStyle} />
          </div>
        </div>
      </article>
    );
  };

  const updateBullpenRowCount = (nextCountRaw: number) => {
    const nextCount = Math.max(BULLPEN_MIN_ROWS, Math.min(BULLPEN_MAX_ROWS, nextCountRaw || 20));
    const updater = (prev: BullpenScript) => ({
      ...prev,
      rowCount: nextCount,
      rows: buildBullpenRows(nextCount, prev.columns.length, prev.rows),
    });
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  const updateBullpenColumnCount = (nextCountRaw: number) => {
    const nextCount = Math.max(1, Math.min(16, nextCountRaw || DEFAULT_BULLPEN_COLUMNS.length));
    const updater = (prev: BullpenScript) => {
      const currentCols = Array.isArray(prev.columns) && prev.columns.length ? prev.columns : [...DEFAULT_BULLPEN_COLUMNS];
      const nextCols = currentCols.slice(0, nextCount);
      while (nextCols.length < nextCount) nextCols.push(`Column ${nextCols.length + 1}`);
      const nextColumnTypes = normalizeBullpenColumnTypes(prev.columnTypes, currentCols.length).slice(0, nextCount);
      while (nextColumnTypes.length < nextCount) nextColumnTypes.push(DEFAULT_BULLPEN_COLUMN_TYPE);
      return {
        ...prev,
        columns: nextCols,
        columnTypes: nextColumnTypes,
        rows: buildBullpenRows(prev.rowCount, nextCols.length, prev.rows),
      };
    };
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  const updateBullpenColumnTitle = (columnIndex: number, value: string) => {
    const updater = (prev: BullpenScript) => {
      const cols = [...prev.columns];
      cols[columnIndex] = value;
      return { ...prev, columns: cols };
    };
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  const updateBullpenColumnType = (columnIndex: number, value: BullpenColumnType) => {
    const updater = (prev: BullpenScript) => {
      const columnTypes = normalizeBullpenColumnTypes(prev.columnTypes, prev.columns.length);
      columnTypes[columnIndex] = value;
      return { ...prev, columnTypes };
    };
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  const moveBullpenColumn = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const updater = (prev: BullpenScript) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= prev.columns.length || toIndex >= prev.columns.length) return prev;
      const columns = [...prev.columns];
      const [movedColumn] = columns.splice(fromIndex, 1);
      columns.splice(toIndex, 0, movedColumn);
      const columnTypes = normalizeBullpenColumnTypes(prev.columnTypes, prev.columns.length);
      const [movedColumnType] = columnTypes.splice(fromIndex, 1);
      columnTypes.splice(toIndex, 0, movedColumnType);
      const rows = buildBullpenRows(prev.rowCount, prev.columns.length, prev.rows).map((row) => {
        const nextRow = [...row];
        const [movedValue] = nextRow.splice(fromIndex, 1);
        nextRow.splice(toIndex, 0, movedValue);
        return nextRow;
      });
      return { ...prev, columns, columnTypes, rows };
    };
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  const updateBullpenCell = (rowIndex: number, field: number, value: string) => {
    const updater = (prev: BullpenScript) => {
      const rows = buildBullpenRows(prev.rowCount, prev.columns.length, prev.rows);
      const nextRow = [...rows[rowIndex]];
      nextRow[field] = value;
      rows[rowIndex] = nextRow;
      return { ...prev, rows };
    };
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  const copyBullpenCell = (sourceRow: number, sourceField: BullpenFieldKey, targetRow: number, targetField: BullpenFieldKey) => {
    const updater = (prev: BullpenScript) => {
      const rows = buildBullpenRows(prev.rowCount, prev.columns.length, prev.rows);
      const source = rows[sourceRow]?.[sourceField] ?? '';
      const nextRow = [...rows[targetRow]];
      nextRow[targetField] = source;
      rows[targetRow] = nextRow;
      return { ...prev, rows };
    };
    if (isVelocityView) setVelocityCurrent(updater);
    else setBullpenCurrent(updater);
  };

  useEffect(() => {
    if (!bullpenFillDrag) return;
    const onMouseUp = () => {
      const targets = Array.from(bullpenFillTargetsRef.current);
      if (targets.length) {
        const applyFill = (prev: BullpenScript) => {
          const rows = buildBullpenRows(prev.rowCount, prev.columns.length, prev.rows);
          for (const key of targets) {
            const [rowRaw, fieldRaw] = key.split('__');
            const rowIndex = Number(rowRaw);
            const field = Number(fieldRaw);
            if (!Number.isFinite(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) continue;
            if (!Number.isFinite(field) || field < 0 || field >= prev.columns.length) continue;
            const nextRow = [...rows[rowIndex]];
            nextRow[field] = bullpenFillDrag.value;
            rows[rowIndex] = nextRow;
          }
          return { ...prev, rows };
        };
        if (isVelocityView) setVelocityCurrent(applyFill);
        else setBullpenCurrent(applyFill);
      }
      bullpenFillTargetsRef.current = new Set();
      setBullpenFillDrag(null);
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [bullpenFillDrag, isVelocityView]);

  const startNewBullpenScript = () => {
    if (isVelocityView) {
      setSelectedVelocityTemplateId('');
      setVelocityCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
    } else {
      setSelectedBullpenTemplateId('');
      setBullpenCurrent({ title: '', rowCount: 20, columns: [...DEFAULT_BULLPEN_COLUMNS], rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length) });
      setBullpenCurrentCategory('');
    }
  };

  const applyBullpenTemplate = (templateId: string) => {
    if (!templateId) return;
    const selected = activeTemplates.find((template) => template.id === templateId);
    if (!selected) return;
    if (isVelocityView) setSelectedVelocityTemplateId(selected.id);
    else setSelectedBullpenTemplateId(selected.id);
    if (!isVelocityView) setBullpenCurrentCategory((selected.category ?? '') as BullpenCategory);
    const nextCurrent = {
      title: selected.name,
      rowCount: selected.rowCount,
      columns: selected.columns?.length ? selected.columns : [...DEFAULT_BULLPEN_COLUMNS],
      columnTypes: normalizeBullpenColumnTypes(selected.columnTypes, selected.columns?.length ? selected.columns.length : DEFAULT_BULLPEN_COLUMNS.length),
      rows: buildBullpenRows(selected.rowCount, (selected.columns?.length ? selected.columns : DEFAULT_BULLPEN_COLUMNS).length, selected.rows),
    };
    if (isVelocityView) setVelocityCurrent(nextCurrent);
    else setBullpenCurrent(nextCurrent);
  };

  const saveBullpenTemplate = () => {
    const name = activeCurrent.title.trim();
    if (!name) {
      setError(`${isVelocityView ? 'Velocity' : 'Bullpen'} script title is required before saving template.`);
      return;
    }
    const nowIso = new Date().toISOString();
    const templateId = activeSavedTemplateSelected ? activeSelectedTemplateId : `${isVelocityView ? 'vl' : 'bp'}-${Date.now()}`;
    const next: BullpenTemplate = {
      id: templateId,
      name,
      category: isVelocityView ? undefined : (bullpenCurrentCategory || undefined),
      rowCount: activeCurrent.rowCount,
      columns: activeCurrent.columns,
      columnTypes: normalizeBullpenColumnTypes(activeCurrent.columnTypes, activeCurrent.columns.length),
      rows: buildBullpenRows(activeCurrent.rowCount, activeCurrent.columns.length, activeCurrent.rows),
      updatedAt: nowIso,
    };
    const applyTemplates = (prev: BullpenTemplate[]) => {
      const idx = prev.findIndex((template) => template.id === templateId);
      if (idx < 0) return [next, ...prev];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    };
    const nextBullpenTemplates = isVelocityView ? bullpenTemplates : applyTemplates(bullpenTemplates);
    const nextVelocityTemplates = isVelocityView ? applyTemplates(velocityTemplates) : velocityTemplates;
    if (isVelocityView) {
      setVelocityTemplates(applyTemplates);
      setSelectedVelocityTemplateId(templateId);
      setVisibleVelocityTemplateIds((prev) => Array.from(new Set([templateId, ...prev])));
    } else {
      setBullpenTemplates(applyTemplates);
      setSelectedBullpenTemplateId(templateId);
      setVisibleBullpenTemplateIds((prev) => Array.from(new Set([templateId, ...prev])));
    }
    setError('');
    // When no player is selected, immediately persist to shared storage — don't rely on debounced auto-save.
    if (!playerId) {
      void fetchWithTimeout('/api/admin/schedule/throwing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: 0,
          byDate: {},
          weekNotes: {},
          templates: [],
          bullpenState: { current: bullpenCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
          bullpenTemplates: nextBullpenTemplates,
          velocityState: { current: velocityCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
          velocityTemplates: nextVelocityTemplates,
          drillsState: normalizeDrillsState(null),
          preThrowDrillTemplates,
          postThrowDrillTemplates,
        }),
      }).catch(() => {});
    }
  };

  const duplicateBullpenTemplate = () => {
    const sourceName = activeCurrent.title.trim() || activeTemplates.find((template) => template.id === activeSelectedTemplateId)?.name?.trim();
    const baseName = sourceName || `${isVelocityView ? 'Velocity' : 'Bullpen'} Script`;
    const name = `${baseName} Copy`;
    const nowIso = new Date().toISOString();
    const templateId = `${isVelocityView ? 'vl' : 'bp'}-${Date.now()}`;
    const columnTypes = normalizeBullpenColumnTypes(activeCurrent.columnTypes, activeCurrent.columns.length);
    const next: BullpenTemplate = {
      id: templateId,
      name,
      category: isVelocityView ? undefined : (bullpenCurrentCategory || undefined),
      rowCount: activeCurrent.rowCount,
      columns: [...activeCurrent.columns],
      columnTypes,
      rows: buildBullpenRows(activeCurrent.rowCount, activeCurrent.columns.length, activeCurrent.rows),
      updatedAt: nowIso,
    };
    const nextCurrent: BullpenScript = {
      title: name,
      rowCount: next.rowCount,
      columns: [...next.columns],
      columnTypes: [...columnTypes],
      rows: buildBullpenRows(next.rowCount, next.columns.length, next.rows),
    };
    const nextBullpenTemplates = isVelocityView ? bullpenTemplates : [next, ...bullpenTemplates];
    const nextVelocityTemplates = isVelocityView ? [next, ...velocityTemplates] : velocityTemplates;

    if (isVelocityView) {
      setVelocityTemplates(nextVelocityTemplates);
      setSelectedVelocityTemplateId(templateId);
      setVisibleVelocityTemplateIds((prev) => Array.from(new Set([templateId, ...prev])));
      setVelocityCurrent(nextCurrent);
    } else {
      setBullpenTemplates(nextBullpenTemplates);
      setSelectedBullpenTemplateId(templateId);
      setVisibleBullpenTemplateIds((prev) => Array.from(new Set([templateId, ...prev])));
      setBullpenCurrent(nextCurrent);
    }
    setError('');

    if (!playerId) {
      void fetchWithTimeout('/api/admin/schedule/throwing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: 0,
          byDate: {},
          weekNotes: {},
          templates: [],
          bullpenState: { current: isVelocityView ? bullpenCurrent : nextCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
          bullpenTemplates: nextBullpenTemplates,
          velocityState: { current: isVelocityView ? nextCurrent : velocityCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
          velocityTemplates: nextVelocityTemplates,
          drillsState: normalizeDrillsState(null),
          preThrowDrillTemplates,
          postThrowDrillTemplates,
        }),
      }).catch(() => {});
    }
  };

  const deleteBullpenTemplate = () => {
    const templateId = activeSelectedTemplateId;
    if (!templateId) {
      setError(`Select a saved ${isVelocityView ? 'velocity' : 'bullpen'} script to delete.`);
      return;
    }
    const selected = activeTemplates.find((template) => template.id === templateId);
    const confirmed = window.confirm(`Delete ${selected?.name ?? 'this script'}?`);
    if (!confirmed) return;
    setScriptVisibilityMenuOpen(false);

    const nextBullpenTemplates = isVelocityView
      ? bullpenTemplates
      : bullpenTemplates.filter((template) => template.id !== templateId);
    const nextVelocityTemplates = isVelocityView
      ? velocityTemplates.filter((template) => template.id !== templateId)
      : velocityTemplates;
    const resetCurrent = {
      title: '',
      rowCount: 20,
      columns: [...DEFAULT_BULLPEN_COLUMNS],
      rows: buildBullpenRows(20, DEFAULT_BULLPEN_COLUMNS.length),
    };

    if (isVelocityView) {
      setVelocityTemplates(nextVelocityTemplates);
      setSelectedVelocityTemplateId('');
      setVisibleVelocityTemplateIds((prev) => prev.filter((id) => id !== templateId));
      setVelocityCurrent(resetCurrent);
    } else {
      setBullpenTemplates(nextBullpenTemplates);
      setSelectedBullpenTemplateId('');
      setVisibleBullpenTemplateIds((prev) => prev.filter((id) => id !== templateId));
      setBullpenCurrent(resetCurrent);
    }
    setError('');

    // With no player selected, persist shared template changes immediately because autosave is player-scoped.
    if (!playerId) {
      void fetchWithTimeout('/api/admin/schedule/throwing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: 0,
          byDate: {},
          weekNotes: {},
          templates: [],
          bullpenState: { current: bullpenCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
          bullpenTemplates: nextBullpenTemplates,
          velocityState: { current: velocityCurrent, selectedTemplateId: '', visibleTemplateIds: [], notes: '' },
          velocityTemplates: nextVelocityTemplates,
          drillsState: normalizeDrillsState(null),
          preThrowDrillTemplates,
          postThrowDrillTemplates,
        }),
      }).catch(() => {});
    }
  };

  const applyDrillTemplate = (section: 'pre' | 'post', templateId: string) => {
    const templates = section === 'pre' ? preThrowDrillTemplates : postThrowDrillTemplates;
    const selected = templates.find((template) => template.id === templateId);
    if (!selected) {
      if (section === 'pre') {
        setSelectedPreDrillTemplateId('');
        setPreDrillTemplateName('');
      } else {
        setSelectedPostDrillTemplateId('');
        setPostDrillTemplateName('');
      }
      return;
    }
    if (section === 'pre') {
      setSelectedPreDrillTemplateId(selected.id);
      setPreDrillTemplateName(selected.name);
      setDrillsRowCount(selected.rowCount);
      setDrillsRows(normalizeDrillRows(selected.rows, selected.rowCount));
    } else {
      setSelectedPostDrillTemplateId(selected.id);
      setPostDrillTemplateName(selected.name);
      setPostDrillsRowCount(selected.rowCount);
      setPostDrillsRows(normalizeDrillRows(selected.rows, selected.rowCount));
    }
  };

  const startNewDrillTemplate = (section: 'pre' | 'post') => {
    if (section === 'pre') {
      setSelectedPreDrillTemplateId('');
      setPreDrillTemplateName('');
      setDrillsRowCount(DEFAULT_DRILL_ROW_COUNT);
      setDrillsRows(normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
    } else {
      setSelectedPostDrillTemplateId('');
      setPostDrillTemplateName('');
      setPostDrillsRowCount(DEFAULT_DRILL_ROW_COUNT);
      setPostDrillsRows(normalizeDrillRows([], DEFAULT_DRILL_ROW_COUNT));
    }
  };

  const saveDrillTemplate = (section: 'pre' | 'post') => {
    const name = (section === 'pre' ? preDrillTemplateName : postDrillTemplateName).trim();
    if (!name) {
      setError(`${section === 'pre' ? 'Pre-Throw' : 'Post-Throw'} template name is required.`);
      return;
    }
    const selectedId = section === 'pre' ? selectedPreDrillTemplateId : selectedPostDrillTemplateId;
    const rowCount = section === 'pre' ? drillsRowCount : postDrillsRowCount;
    const rows = section === 'pre' ? drillsRows : postDrillsRows;
    const id = selectedId || `${section}-drill-${Date.now()}`;
    const template: DrillTemplate = {
      id,
      name,
      rowCount,
      rows: normalizeDrillRows(rows, rowCount),
      updatedAt: new Date().toISOString(),
    };
    const updateTemplates = (previous: DrillTemplate[]) => {
      const index = previous.findIndex((item) => item.id === id);
      if (index < 0) return [template, ...previous];
      const next = [...previous];
      next[index] = template;
      return next;
    };
    if (section === 'pre') {
      setPreThrowDrillTemplates(updateTemplates);
      setSelectedPreDrillTemplateId(id);
    } else {
      setPostThrowDrillTemplates(updateTemplates);
      setSelectedPostDrillTemplateId(id);
    }
    setError('');
  };

  const renderDrillSection = (section: 'pre' | 'post') => {
    const isPre = section === 'pre';
    const sectionRows = isPre ? drillsRows : postDrillsRows;
    const sectionRowCount = isPre ? drillsRowCount : postDrillsRowCount;
    const updateRows = isPre ? setDrillsRows : setPostDrillsRows;
    return (
      <section key={`drill-section-${section}`} className="portal-panel portal-drills-section">
        <h3>{isPre ? 'Pre-Throw Plyos and Drills' : 'Post-Throw Plyos and Drills'}</h3>
        <div className="portal-table-wrap">
          <table className="portal-drills-table">
            <colgroup>
              <col className="portal-drills-col-drill" />
              <col className="portal-drills-col-compact" />
              <col className="portal-drills-col-compact" />
              <col className="portal-drills-col-compact" />
              <col className="portal-drills-col-notes" />
            </colgroup>
            <thead>
              <tr>
                {['Drill', 'Sets', 'Reps', 'Weight', 'Notes'].map((label) => <th key={label}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sectionRows.slice(0, sectionRowCount).map((row, index) => (
                <tr key={`${section}-drill-row-${index}`}>
                  {(['drill', 'sets', 'reps', 'weight', 'notes'] as const).map((field) => (
                    <td key={`${section}-${index}-${field}`}>
                      {field === 'drill' ? (
                        <div className="portal-drill-picker-cell">
                          <textarea
                            className="portal-schedule-control"
                            value={row.drill}
                            placeholder="Select drill"
                            rows={2}
                            onChange={(event) => updateRows((previous) => {
                              const next = [...previous];
                              next[index] = { ...(next[index] ?? emptyDrillRow()), drill: event.target.value };
                              return next;
                            })}
                          />
                          {(() => {
                            const selected = drillExerciseOptions.find((option) => option.name === row.drill);
                            const videoUrl = String(selected?.instructionVideoUrl ?? '').trim();
                            if (!videoUrl) return null;
                            return (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setDrillVideoPreview({ title: selected?.name ?? 'Drill Video', url: embedVideoUrl(videoUrl) })}
                              >
                                Video
                              </button>
                            );
                          })()}
                        </div>
                      ) : (
                        <textarea
                          className="portal-schedule-control"
                          value={row[field]}
                          rows={2}
                          onChange={(event) => updateRows((previous) => {
                            const next = [...previous];
                            next[index] = { ...(next[index] ?? emptyDrillRow()), [field]: event.target.value };
                            return next;
                          })}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const downloadBullpenScript = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 28;
      const isLightTheme =
        typeof document !== 'undefined' &&
        document.body.classList.contains('theme-light');

      const loadImageDataUrl = async (src: string): Promise<string | null> => {
        try {
          const response = await fetch(src);
          if (!response.ok) return null;
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(new Error('Failed reading image.'));
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      };

      const [leftLogo, rightLogo] = await Promise.all([
        loadImageDataUrl(schoolLogoSrc ?? '/pitching-coach-u-logo.png'),
        loadImageDataUrl('/pitching-coach-u-logo.png'),
      ]);

      const logoW = 42;
      const logoH = 42;
      if (!isLightTheme) {
        pdf.setFillColor(8, 10, 16);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      }
      if (leftLogo) pdf.addImage(leftLogo, 'PNG', margin, margin - 8, logoW, logoH);
      if (rightLogo) pdf.addImage(rightLogo, 'PNG', pageWidth - margin - logoW, margin - 8, logoW, logoH);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(isLightTheme ? 15 : 248, isLightTheme ? 23 : 250, isLightTheme ? 42 : 252);
      const scriptTitle = activeCurrent.title.trim() || (isVelocityView ? 'Velocity Script' : 'Bullpen Script');
      pdf.text(scriptTitle, pageWidth / 2, margin + 12, { align: 'center' });

      const headers = ['Pitch #', ...activeCurrent.columns.map((value) => value.trim() || 'Column')];
      const dynamicCount = activeCurrent.columns.length;
      const dynamicWidths = activeCurrent.columns.map((_, idx) => {
        if (idx === dynamicCount - 1) return 180;
        if (idx === dynamicCount - 2) return 138;
        return 95;
      });
      const colWidths = [52, ...dynamicWidths];
      const tableWidth = colWidths.reduce((sum, width) => sum + width, 0);
      const startX = Math.max(margin, (pageWidth - tableWidth) / 2);
      let y = margin + 56;
      const rows = buildBullpenRows(activeCurrent.rowCount, activeCurrent.columns.length, activeCurrent.rows);
      const rowCountTotal = rows.length + 1;
      const availableHeight = Math.max(1, pageHeight - y - margin);
      const rowHeight = Math.max(8, Math.min(20, availableHeight / Math.max(1, rowCountTotal)));
      const headerFontSize = Math.max(6.5, Math.min(10, rowHeight * 0.46));
      const rowFontSize = Math.max(6, Math.min(9, rowHeight * 0.44));
      const baselineY = rowHeight * 0.68;

      const drawRow = (cells: string[], isHeader = false) => {
        let x = startX;
        pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
        pdf.setFontSize(isHeader ? headerFontSize : rowFontSize);
        for (let i = 0; i < cells.length; i += 1) {
          const width = colWidths[i];
          if (isHeader) {
            if (isLightTheme) pdf.setFillColor(241, 245, 249);
            else pdf.setFillColor(20, 26, 37);
            pdf.rect(x, y, width, rowHeight, 'F');
          }
          pdf.setDrawColor(isLightTheme ? 148 : 71, isLightTheme ? 163 : 85, isLightTheme ? 184 : 105);
          pdf.setLineWidth(0.6);
          pdf.rect(x, y, width, rowHeight);
          pdf.setTextColor(isLightTheme ? 15 : 241, isLightTheme ? 23 : 245, isLightTheme ? 42 : 249);
          pdf.text(String(cells[i] ?? ''), x + width / 2, y + baselineY, { align: 'center', maxWidth: width - 8 });
          x += width;
        }
        y += rowHeight;
      };

      drawRow(headers, true);
      for (let idx = 0; idx < rows.length; idx += 1) {
        const row = rows[idx];
        drawRow([String(idx + 1), ...row.map((value) => String(value ?? ''))]);
      }

      const safeTitle = scriptTitle.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'bullpen-script';
      pdf.save(`${safeTitle}.pdf`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to export bullpen script PDF.');
    }
  };

  return (
    <div className="portal-admin-stack">
      <div className="portal-schedule-toolbar">
        <div className="portal-schedule-view-switch" role="group" aria-label="Builder mode">
          {(['schedule', 'template'] as BuilderMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`btn ${builderMode === mode ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                setBuilderMode(mode);
                if (mode === 'template') setPaletteMode('workouts');
              }}
            >
              {mode === 'schedule' ? 'Schedule Builder' : 'Template Builder'}
            </button>
          ))}
        </div>
        {builderMode === 'schedule' ? (
          <>
            <div className="portal-schedule-player-picker" ref={playerPickerRef}>
              <label htmlFor="schedule-player-search">Player</label>
              <div className="portal-schedule-player-combobox">
                <input
                  id="schedule-player-search"
                  className="portal-schedule-control"
                  value={playerQuery}
                  onFocus={() => {
                    setPlayerPickerOpen(true);
                    setPlayerPickerShowAll(false);
                  }}
                  onChange={(event) => {
                    setPlayerQuery(event.target.value);
                    setPlayerPickerOpen(true);
                    setPlayerPickerShowAll(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setPlayerPickerOpen(true);
                    } else if (event.key === 'Escape') {
                      setPlayerPickerOpen(false);
                      setPlayerPickerShowAll(false);
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      const q = playerQuery.trim().toLowerCase();
                      const exact = players.find((player) => player.name.trim().toLowerCase() === q);
                      const nextPlayer = exact ?? filteredPlayers[0];
                      if (nextPlayer) selectPlayer(nextPlayer);
                    }
                  }}
                  placeholder="Search player..."
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={playerPickerOpen}
                  aria-controls="schedule-player-search-options"
                  aria-label="Search player"
                />
                <button
                  type="button"
                  className="portal-schedule-player-toggle"
                  aria-label={playerPickerOpen && playerPickerShowAll ? 'Close player list' : 'Show all players'}
                  aria-expanded={playerPickerOpen}
                  aria-haspopup="listbox"
                  aria-controls="schedule-player-search-options"
                  onClick={() => {
                    if (playerPickerOpen && playerPickerShowAll) {
                      setPlayerPickerOpen(false);
                      setPlayerPickerShowAll(false);
                    } else {
                      setPlayerPickerOpen(true);
                      setPlayerPickerShowAll(true);
                    }
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {playerPickerOpen ? (
                  <div id="schedule-player-search-options" className="portal-schedule-player-options" role="listbox" aria-label="Players">
                    {filteredPlayers.length > 0 ? filteredPlayers.map((player) => (
                      <button
                        key={player.id}
                        type="button"
                        role="option"
                        aria-selected={player.id === playerId}
                        className={`portal-schedule-player-option${player.id === playerId ? ' is-selected' : ''}`}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => selectPlayer(player)}
                      >
                        <span>{player.name}</span>
                        {player.id === playerId ? <span aria-hidden="true">✓</span> : null}
                      </button>
                    )) : (
                      <p className="portal-schedule-player-empty">No matching players.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            {playerId > 0 && (view === 'bullpens' || view === 'velocity') ? (
              <button type="button" className="btn btn-ghost" onClick={() => { setPlayerId(0); setPlayerQuery(''); }}>
                Clear Player
              </button>
            ) : null}
            {playerId > 0 && view !== 'bullpens' && view !== 'velocity' ? (
              <Link href={`/portal/player?previewPlayerId=${playerId}`} className="btn btn-ghost as-link">
                View Profile
              </Link>
            ) : null}
            <div className="portal-schedule-view-switch" role="group" aria-label="Calendar view">
              {(['day', 'week', 'month', 'cycle', 'throwing', 'bullpens', 'drills'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`btn ${view === mode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => {
                    jumpToCurrentForView(mode);
                    setView(mode);
                  }}
                >
                  {mode === 'cycle'
                    ? '3-Day Cycle'
                    : mode === 'throwing'
                      ? 'Throwing Calendar'
                      : mode === 'bullpens'
                        ? 'Bullpens'
                        : `${mode[0].toUpperCase()}${mode.slice(1)}`}
                </button>
              ))}
            </div>
            {view === 'throwing' && (
              <>
                <div className="portal-schedule-view-switch" role="group" aria-label="Throwing mode">
                  <button
                    type="button"
                    className={`btn ${throwingBuilderMode === 'month' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => {
                      setThrowingBuilderMode('month');
                      setThrowingCalendarView('month');
                    }}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className={`btn ${throwingBuilderMode === 'weeks' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setThrowingBuilderMode('weeks')}
                  >
                    Week Builder
                  </button>
                  {throwingBuilderMode === 'weeks' && (
                    <button type="button" className="btn btn-ghost" onClick={() => void downloadThrowingCalendar()}>
                      Download PDF
                    </button>
                  )}
                </div>
                {throwingBuilderMode === 'month' && (
                  <div className="portal-schedule-view-switch" role="group" aria-label="Throwing calendar view">
                    {(['day', 'week', 'month'] as ThrowingCalendarView[]).map((mode) => (
                      <button
                        key={`throwing-subview-${mode}`}
                        type="button"
                        className={`btn ${throwingCalendarView === mode ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setThrowingCalendarView(mode)}
                      >
                        {mode[0].toUpperCase()}
                        {mode.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
                {throwingBuilderMode === 'month' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Apply Week Builder Template
                      <select className="portal-schedule-control" value={throwingApplyTemplateId} onChange={(event) => setThrowingApplyTemplateId(event.target.value)}>
                        <option value="">Select template</option>
                        {throwingTemplates.map((template) => (
                          <option key={`apply-${template.id}`} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Start Day</span>
                      <span style={{ fontSize: '0.82rem' }}>{throwingApplyStartDate || 'Click a day below'}</span>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={applyWeekBuilderTemplateToMonth}>
                      Apply Template
                    </button>
                  </div>
                )}
                {throwingBuilderMode === 'weeks' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Template
                      <select className="portal-schedule-control" value={selectedThrowingTemplateId} onChange={(event) => selectThrowingTemplate(event.target.value)}>
                        <option value="">New Template</option>
                        {throwingTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Name
                      <input className="portal-schedule-control" value={throwingTemplateName} onChange={(event) => setThrowingTemplateName(event.target.value)} placeholder="Template name" />
                    </label>
                    <label style={{ display: 'grid', gap: 4 }}>
                      Weeks
                      <input
                        className="portal-schedule-control"
                        type="number"
                        min={THROWING_MIN_WEEKS}
                        max={THROWING_MAX_WEEKS}
                        value={throwingTemplateWeekCount}
                        onChange={(event) =>
                          setThrowingTemplateWeekCount(
                            Math.max(THROWING_MIN_WEEKS, Math.min(THROWING_MAX_WEEKS, Number(event.target.value) || THROWING_MIN_WEEKS))
                          )
                        }
                        style={{ width: 90 }}
                      />
                    </label>
                    <button type="button" className="btn btn-primary" onClick={saveThrowingTemplate}>
                      Save Template
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={!selectedThrowingTemplateId} onClick={deleteThrowingTemplate}>
                      Delete Template
                    </button>
                  </div>
                )}
                {throwingBuilderMode !== 'weeks' && throwingCalendarView !== 'day' && (
                  <button type="button" className="btn btn-ghost" onClick={() => void downloadThrowingCalendar()}>
                    Download PDF
                  </button>
                )}
              </>
            )}
            {(view === 'bullpens' || view === 'velocity') && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-expanded={!scriptTemplateBuilderCollapsed}
                    onClick={() => setScriptTemplateBuilderCollapsed((previous) => !previous)}
                    style={{ minWidth: 188, minHeight: 42, justifyContent: 'center', whiteSpace: 'nowrap' }}
                  >
                    {scriptTemplateBuilderCollapsed ? 'Show Script Builder' : 'Hide Script Builder'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void downloadBullpenScript()}
                    style={{ minWidth: 154, minHeight: 42, justifyContent: 'center', whiteSpace: 'nowrap' }}
                  >
                    Download PDF
                  </button>
                </div>
                {!scriptTemplateBuilderCollapsed ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: !isVelocityView ? '220px 1fr' : '1fr', gap: 12, alignItems: 'start' }}>
                      {/* Folder browser — bullpen only */}
                      {!isVelocityView ? (
                        <div style={{ border: '1px solid var(--calendar-grid-border, var(--border))', borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.18)' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, padding: '7px 10px 5px', borderBottom: '1px solid var(--calendar-grid-border, var(--border))' }}>Script Library</div>
                          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                            {/* Category folders */}
                            {[...BULLPEN_CATEGORIES, '' as const].map((cat) => {
                              const inCat = activeTemplates.filter((t) => (t.category ?? '') === cat);
                              if (!inCat.length) return null;
                              const folderKey = cat || '__uncategorized';
                              const label = cat || 'Uncategorized';
                              const isOpen = openFolders.has(folderKey);
                              return (
                                <div key={folderKey}>
                                  <button
                                    type="button"
                                    onClick={() => setOpenFolders((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(folderKey)) next.delete(folderKey); else next.add(folderKey);
                                      return next;
                                    })}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'inherit', borderBottom: '1px solid var(--calendar-grid-border, var(--border))' }}
                                  >
                                    <span style={{ fontSize: 10, opacity: 0.6 }}>{isOpen ? '▾' : '▸'}</span>
                                    <span style={{ fontSize: 13 }}>📁</span>
                                    <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                                    <span style={{ fontSize: 10, opacity: 0.45 }}>{inCat.length}</span>
                                  </button>
                                  {isOpen ? inCat.map((t) => {
                                    const isSelected = activeSelectedTemplateId === t.id;
                                    const isVisible = activeVisibleTemplateIds.includes(t.id);
                                    return (
                                      <div
                                        key={t.id}
                                        style={{ display: 'flex', alignItems: 'center', gap: 0, paddingLeft: 24, borderBottom: '1px solid var(--calendar-grid-border, var(--border))', background: isSelected ? 'rgba(99,102,241,0.18)' : undefined }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => { setSelectedBullpenTemplateId(t.id); applyBullpenTemplate(t.id); }}
                                          style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '5px 6px', fontSize: 12, fontWeight: isSelected ? 700 : 400, color: isSelected ? '#a5b4fc' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        >
                                          {t.name}
                                        </button>
                                        <label title="Player-visible" style={{ display: 'flex', alignItems: 'center', padding: '0 8px', cursor: 'pointer', flexShrink: 0 }}>
                                          <input
                                            type="checkbox"
                                            checked={isVisible}
                                            onChange={(e) => {
                                              const checked = e.target.checked;
                                              setVisibleBullpenTemplateIds((prev) => checked ? Array.from(new Set([...prev, t.id])) : prev.filter((id) => id !== t.id));
                                            }}
                                            style={{ accentColor: '#22c55e', cursor: 'pointer' }}
                                          />
                                        </label>
                                      </div>
                                    );
                                  }) : null}
                                </div>
                              );
                            })}
                            {activeTemplates.length === 0 ? <div style={{ padding: '10px', fontSize: 12, opacity: 0.45 }}>No scripts saved yet.</div> : null}
                          </div>
                          <div style={{ padding: '5px 8px', borderTop: '1px solid var(--calendar-grid-border, var(--border))', fontSize: 10, opacity: 0.4 }}>
                            ✓ = player-visible
                          </div>
                        </div>
                      ) : null}
                      {/* Right side: script editor controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {isVelocityView ? (
                          <label style={{ display: 'grid', gap: 4 }}>
                            Script Template
                            <select
                              className="portal-schedule-control"
                              value={activeSelectedTemplateId}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSelectedVelocityTemplateId(value);
                                if (value) applyBullpenTemplate(value);
                              }}
                              style={{ minWidth: 200 }}
                            >
                              <option value="">Current Player Script</option>
                              {activeTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </label>
                        ) : null}
                      <label style={{ display: 'grid', gap: 4 }}>
                        Script Title
                        <input
                          className="portal-schedule-control"
                          value={activeCurrent.title}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (isVelocityView) setVelocityCurrent((prev) => ({ ...prev, title: value }));
                            else setBullpenCurrent((prev) => ({ ...prev, title: value }));
                          }}
                          placeholder={view === 'velocity' ? 'Velocity Script Title' : 'Bullpen Script Title'}
                        />
                      </label>
                      {!isVelocityView ? (
                        <label style={{ display: 'grid', gap: 4 }}>
                          Category
                          <select
                            className="portal-schedule-control"
                            value={bullpenCurrentCategory}
                            onChange={(event) => setBullpenCurrentCategory(event.target.value as BullpenCategory)}
                          >
                            <option value="">— None —</option>
                            {BULLPEN_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label style={{ display: 'grid', gap: 4 }}>
                        Pitches (Rows)
                        <input
                          className="portal-schedule-control"
                          type="number"
                          min={BULLPEN_MIN_ROWS}
                          max={BULLPEN_MAX_ROWS}
                          value={activeCurrent.rowCount}
                          onChange={(event) => updateBullpenRowCount(Number(event.target.value))}
                          style={{ width: 110 }}
                        />
                      </label>
                      <label style={{ display: 'grid', gap: 4 }}>
                        Columns
                        <input
                          className="portal-schedule-control"
                          type="number"
                          min={1}
                          max={16}
                          value={activeCurrent.columns.length}
                          onChange={(event) => updateBullpenColumnCount(Number(event.target.value))}
                          style={{ width: 90 }}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={saveBullpenTemplate}
                        style={{ minWidth: 154, minHeight: 42, justifyContent: 'center', whiteSpace: 'nowrap' }}
                      >
                        {activeSavedTemplateSelected ? 'Update Script' : 'Save New Script'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={duplicateBullpenTemplate}
                        style={{ minWidth: 154, minHeight: 42, justifyContent: 'center', whiteSpace: 'nowrap' }}
                      >
                        Duplicate Script
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={startNewBullpenScript}
                        style={{ minWidth: 154, minHeight: 42, justifyContent: 'center', whiteSpace: 'nowrap' }}
                      >
                        New Script
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!activeSelectedTemplateId}
                        onClick={deleteBullpenTemplate}
                        style={{
                          minWidth: 154,
                          minHeight: 42,
                          justifyContent: 'center',
                          whiteSpace: 'nowrap',
                          borderColor: activeSelectedTemplateId ? 'rgba(248,113,113,0.55)' : undefined,
                          color: activeSelectedTemplateId ? '#fecaca' : undefined,
                          background: activeSelectedTemplateId ? 'rgba(127,29,29,0.18)' : undefined,
                        }}
                      >
                        Delete Script
                      </button>
                    </div>
                    </div>{/* end grid: folder browser + controls */}
                    <div style={{ display: 'grid', gap: 6 }}>
                      <label style={{ display: 'grid', gap: 4 }}>
                        {view === 'velocity' ? 'Velocity Notes (player can see)' : 'Bullpen Notes (player can see)'}
                        <textarea
                      className="portal-schedule-control"
                      rows={3}
                      value={isVelocityView ? velocityNotes : bullpenNotes}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (isVelocityView) setVelocityNotes(value);
                        else setBullpenNotes(value);
                      }}
                      placeholder="Write notes for player..."
                    />
                      </label>
                      <div style={{ display: 'grid', gap: 4, maxWidth: 360 }}>
                        <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Player-visible scripts</span>
                        <div className="portal-script-visibility-dropdown" data-open={scriptVisibilityMenuOpen ? 'true' : 'false'}>
                          <button
                            type="button"
                            className="portal-schedule-control portal-script-visibility-summary"
                            aria-expanded={scriptVisibilityMenuOpen}
                            onClick={() => setScriptVisibilityMenuOpen((open) => !open)}
                          >
                            <span>
                              {activeVisibleTemplateIds.length === 0
                                ? 'No scripts selected'
                                : activeVisibleTemplateIds.length === 1
                                  ? '1 script selected'
                                  : `${activeVisibleTemplateIds.length} scripts selected`}
                            </span>
                            <span aria-hidden="true">v</span>
                          </button>
                          {scriptVisibilityMenuOpen ? (
                            <div className="portal-script-visibility-menu">
                              {activeTemplates.length === 0 ? <span className="portal-muted-text">No scripts saved yet.</span> : null}
                              {!isVelocityView ? (
                                <>
                                  {BULLPEN_CATEGORIES.map((cat) => {
                                    const inCat = activeTemplates.filter((t) => t.category === cat);
                                    if (!inCat.length) return null;
                                    return (
                                      <div key={cat}>
                                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, padding: '6px 10px 2px' }}>{cat}</div>
                                        {inCat.map((template) => {
                                          const checked = activeVisibleTemplateIds.includes(template.id);
                                          return (
                                            <label key={`bp-visible-${template.id}`} className="portal-script-visibility-option">
                                              <input type="checkbox" checked={checked} onChange={(event) => {
                                                const isChecked = event.target.checked;
                                                setVisibleBullpenTemplateIds((prev) => isChecked ? Array.from(new Set([...prev, template.id])) : prev.filter((id) => id !== template.id));
                                              }} />
                                              <span>{template.name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                  {activeTemplates.filter((t) => !t.category).map((template) => {
                                    const checked = activeVisibleTemplateIds.includes(template.id);
                                    return (
                                      <label key={`bp-visible-${template.id}`} className="portal-script-visibility-option">
                                        <input type="checkbox" checked={checked} onChange={(event) => {
                                          const isChecked = event.target.checked;
                                          setVisibleBullpenTemplateIds((prev) => isChecked ? Array.from(new Set([...prev, template.id])) : prev.filter((id) => id !== template.id));
                                        }} />
                                        <span>{template.name}</span>
                                      </label>
                                    );
                                  })}
                                </>
                              ) : (
                                activeTemplates.map((template) => {
                                  const checked = activeVisibleTemplateIds.includes(template.id);
                                  return (
                                    <label key={`bp-visible-${template.id}`} className="portal-script-visibility-option">
                                      <input type="checkbox" checked={checked} onChange={(event) => {
                                        const isChecked = event.target.checked;
                                        setVisibleVelocityTemplateIds((prev) => isChecked ? Array.from(new Set([...prev, template.id])) : prev.filter((id) => id !== template.id));
                                      }} />
                                      <span>{template.name}</span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Column Titles (drag to reorder)</span>
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, activeCurrent.columns.length)}, minmax(120px, 1fr))`, gap: 6 }}>
                        {activeCurrent.columns.map((column, idx) => (
                          <div
                            key={`bp-col-control-${idx}`}
                            draggable
                            onDragStart={() => setBullpenColumnDragIndex(idx)}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (bullpenColumnDragIndex === null) return;
                              moveBullpenColumn(bullpenColumnDragIndex, idx);
                              setBullpenColumnDragIndex(null);
                            }}
                            onDragEnd={() => setBullpenColumnDragIndex(null)}
                            style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 4, alignItems: 'start' }}
                          >
                            <span style={{ fontSize: '0.82rem', opacity: 0.72, cursor: 'grab', userSelect: 'none', paddingTop: 10 }}>⋮⋮</span>
                            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                              <input
                                className="portal-schedule-control"
                                value={column}
                                onChange={(event) => updateBullpenColumnTitle(idx, event.target.value)}
                                placeholder={`Column ${idx + 1}`}
                                style={{ textAlign: 'center', fontWeight: 700, minWidth: 0 }}
                              />
                              <select
                                className="portal-schedule-control"
                                value={normalizeBullpenColumnTypes(activeCurrent.columnTypes, activeCurrent.columns.length)[idx] ?? DEFAULT_BULLPEN_COLUMN_TYPE}
                                onChange={(event) => updateBullpenColumnType(idx, event.target.value as BullpenColumnType)}
                                style={{ minWidth: 0, width: '100%', fontSize: '0.82rem', padding: '0.28rem 0.35rem', textAlign: 'center' }}
                              >
                                {BULLPEN_COLUMN_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
            {view === 'drills' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ borderTop: '1px solid var(--calendar-grid-border, var(--border))', paddingTop: 8, display: 'grid', gap: 8 }}>
                  <strong style={{ fontSize: '0.92rem' }}>Quick Add Drill Exercise</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="portal-schedule-control"
                      placeholder="Exercise name"
                      value={newDrillName}
                      onChange={(event) => setNewDrillName(event.target.value)}
                      style={{ minWidth: 220 }}
                    />
                    <select className="portal-schedule-control" value={newDrillCategory} onChange={(event) => setNewDrillCategory(event.target.value)}>
                      <option value="Plyos">Plyos</option>
                      <option value="Throwing">Throwing</option>
                      <option value="Medicine Ball">Medicine Ball</option>
                    </select>
                    <input
                      className="portal-schedule-control"
                      placeholder="Video URL (optional)"
                      value={newDrillVideoUrl}
                      onChange={(event) => setNewDrillVideoUrl(event.target.value)}
                      style={{ minWidth: 260 }}
                    />
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={newDrillSaveToLibrary} onChange={(event) => setNewDrillSaveToLibrary(event.target.checked)} />
                      Add to Exercise Library
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        const name = newDrillName.trim();
                        if (!name) {
                          setError('Exercise name is required.');
                          return;
                        }
                        if (newDrillSaveToLibrary) {
                          const form = new FormData();
                          form.set('name', name);
                          form.set('category', newDrillCategory);
                          form.set('repMeasure', 'reps');
                          form.set('trackingType', 'body_weight');
                          form.set('instructionVideoUrl', newDrillVideoUrl.trim());
                          form.set('description', '');
                          form.set('coachingCues', '');
                          form.set('redirectTo', '/portal/admin/schedule');
                          const response = await fetchWithTimeout('/api/admin/exercises', {
                            method: 'POST',
                            body: form,
                            headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
                          });
                          const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
                          if (!response.ok || payload.ok === false) {
                            setError(payload.error ?? 'Failed to add exercise.');
                            return;
                          }
                        }
                        setDrillExerciseOptions((prev) => {
                          const exists = prev.some((option) => option.name.trim().toLowerCase() === name.toLowerCase());
                          if (exists) return prev;
                          return [
                            ...prev,
                            {
                              id: Number.MIN_SAFE_INTEGER + prev.length,
                              name,
                              category: newDrillCategory,
                              instructionVideoUrl: newDrillVideoUrl.trim() || null,
                            },
                          ].sort((a, b) => a.name.localeCompare(b.name));
                        });
                        setNewDrillName('');
                        setNewDrillVideoUrl('');
                        setError('');
                      }}
                    >
                      Add Drill
                    </button>
                  </div>
                </div>
                <div className="portal-drills-template-controls">
                  {(['pre', 'post'] as const).map((section) => {
                    const isPre = section === 'pre';
                    const templates = isPre ? preThrowDrillTemplates : postThrowDrillTemplates;
                    const selectedId = isPre ? selectedPreDrillTemplateId : selectedPostDrillTemplateId;
                    const templateName = isPre ? preDrillTemplateName : postDrillTemplateName;
                    const rowCount = isPre ? drillsRowCount : postDrillsRowCount;
                    return (
                      <div key={`drill-controls-${section}`} className="portal-drills-template-control">
                        <strong>{isPre ? 'Pre-Throw' : 'Post-Throw'}</strong>
                        <label>
                          Template
                          <select className="portal-schedule-control" value={selectedId} onChange={(event) => applyDrillTemplate(section, event.target.value)}>
                            <option value="">New template</option>
                            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                          </select>
                        </label>
                        <label>
                          Template Name
                          <input
                            className="portal-schedule-control"
                            value={templateName}
                            onChange={(event) => isPre ? setPreDrillTemplateName(event.target.value) : setPostDrillTemplateName(event.target.value)}
                            placeholder={isPre ? 'Pre-throw template name' : 'Post-throw template name'}
                          />
                        </label>
                        <label>
                          Rows
                          <input
                            className="portal-schedule-control"
                            type="number"
                            min={1}
                            max={200}
                            value={rowCount}
                            onChange={(event) => {
                              const nextCount = Math.max(1, Math.min(200, Number(event.target.value) || DEFAULT_DRILL_ROW_COUNT));
                              if (isPre) {
                                setDrillsRowCount(nextCount);
                                setDrillsRows((previous) => normalizeDrillRows(previous, nextCount));
                              } else {
                                setPostDrillsRowCount(nextCount);
                                setPostDrillsRows((previous) => normalizeDrillRows(previous, nextCount));
                              }
                            }}
                          />
                        </label>
                        <div className="portal-drills-template-actions">
                          <button type="button" className="btn btn-primary" onClick={() => saveDrillTemplate(section)}>Save Template</button>
                          <button type="button" className="btn btn-ghost" onClick={() => startNewDrillTemplate(section)}>New Template</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              Template
              <select
                className="portal-schedule-control"
                value={selectedTemplateId ? String(selectedTemplateId) : ''}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next) || next <= 0) {
                    resetTemplateDraft();
                    return;
                  }
                  setSelectedTemplateId(next);
                }}
              >
                <option value="">New Template</option>
                {templates.map((template) => (
                  <option key={template.id} value={String(template.id)}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              Name
              <input
                className="portal-schedule-control"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Template name"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              Weeks
              <input
                className="portal-schedule-control"
                type="number"
                min={TEMPLATE_MIN_WEEKS}
                max={TEMPLATE_MAX_WEEKS}
                value={templateWeekCount}
                onChange={(event) =>
                  setTemplateWeekCount(
                    Math.max(TEMPLATE_MIN_WEEKS, Math.min(TEMPLATE_MAX_WEEKS, Number(event.target.value) || TEMPLATE_MIN_WEEKS))
                  )
                }
                style={{ width: 90 }}
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={() => void saveTemplate()}>
              Save Template
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!selectedTemplateId}
              onClick={() => void deleteTemplate()}
            >
              Delete Template
            </button>
          </div>
        )}
      </div>

      {isMobileSchedule && !(builderMode === 'schedule' && (view === 'throwing' || view === 'bullpens' || view === 'velocity' || view === 'drills')) ? (
        <div style={{ marginBottom: '0.45rem' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setMobilePaletteCollapsed((previous) => !previous)}
          >
            {mobilePaletteCollapsed ? 'Show Workout Folder' : 'Hide Workout Folder'}
          </button>
        </div>
      ) : null}
      <div className="portal-schedule-layout">
        {builderMode === 'schedule' && (view === 'throwing' || view === 'bullpens' || view === 'velocity' || view === 'drills') ? null : (!isMobileSchedule || !mobilePaletteCollapsed) ? (
        <aside className="portal-workout-palette">
          <div className="portal-schedule-view-switch" role="group" aria-label="Palette folder" style={{ marginBottom: 8, flexWrap: 'wrap', rowGap: 6 }}>
            <button
              type="button"
              className={`btn ${paletteMode === 'templates' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                setPaletteMode('templates');
                setSelectedWorkoutCategory(null);
              }}
            >
              Template Folder
            </button>
            <button
              type="button"
              className={`btn ${paletteMode === 'workouts' && workoutPaletteView === 'categories' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                setPaletteMode('workouts');
                setWorkoutPaletteView('categories');
              }}
            >
              Category Folder
            </button>
            <button
              type="button"
              className={`btn ${paletteMode === 'workouts' && workoutPaletteView === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                setPaletteMode('workouts');
                setWorkoutPaletteView('all');
                setSelectedWorkoutCategory(null);
              }}
            >
              All Workouts
            </button>
          </div>
          <div className="portal-search-wrap">
            <input
              type="search"
              value={workoutQuery}
              onChange={(event) => setWorkoutQuery(event.target.value)}
              placeholder={paletteMode === 'workouts' ? 'Search workouts...' : 'Search templates...'}
              className="portal-library-search"
              aria-label={paletteMode === 'workouts' ? 'Search saved workouts' : 'Search saved templates'}
            />
            {paletteMode === 'templates' && workoutQuery.trim().length > 0 && templateSuggestions.length > 0 && (
              <div className="portal-search-dropdown" role="listbox" aria-label="Template search suggestions">
                {templateSuggestions.map((template) => (
                  <button
                    key={`suggest-template-${template.id}`}
                    type="button"
                    className="portal-search-option"
                    draggable={builderMode === 'schedule'}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('templateId', String(template.id));
                    }}
                    onClick={() => setWorkoutQuery(template.name)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="portal-workout-palette-list">
              {paletteMode === 'workouts' && (hasWorkoutSearch || workoutPaletteView === 'all')
                ? filteredWorkouts.map((workout) => (
                    <article
                      key={workout.id}
                      className="portal-workout-palette-item"
                      style={categoryBubbleStyle(workout.category)}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('workoutId', String(workout.id));
                      }}
                    >
                      <strong>{workout.name}</strong>
                    </article>
                  ))
                : null}
              {paletteMode === 'workouts' && !hasWorkoutSearch && workoutPaletteView === 'categories'
                ? selectedWorkoutCategory
                  ? selectedCategoryWorkouts.map((workout) => (
                      <article
                        key={workout.id}
                        className="portal-workout-palette-item"
                        style={categoryBubbleStyle(workout.category)}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('workoutId', String(workout.id));
                        }}
                      >
                        <strong>{workout.name}</strong>
                      </article>
                    ))
                  : workoutCategories.map((group) => (
                    <button
                      key={group.category}
                      type="button"
                      className="portal-workout-palette-item"
                      style={{ ...categoryBubbleStyle(group.category), textAlign: 'left', width: '100%', color: '#fff' }}
                      onClick={() => setSelectedWorkoutCategory(group.category)}
                    >
                      <strong>{group.category}</strong>
                      <div style={{ fontSize: '0.78rem', opacity: 0.85, color: '#fff' }}>{group.items.length} workouts</div>
                    </button>
                  ))
                : filteredTemplates.map((template) => (
                    <article
                      key={`template-${template.id}`}
                      className="portal-workout-palette-item"
                      style={categoryBubbleStyle('Template')}
                      draggable={builderMode === 'schedule'}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('templateId', String(template.id));
                      }}
                    >
                      <strong>{template.name}</strong>
                      <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>
                        {template.workoutCount} workouts · {Math.max(1, Math.ceil(Math.max(1, template.totalDays) / 7))} weeks
                      </div>
                    </article>
                  ))}
              {paletteMode === 'workouts' && !hasWorkoutSearch && workoutPaletteView === 'categories' && selectedWorkoutCategory ? (
                <button type="button" className="btn btn-ghost" onClick={() => setSelectedWorkoutCategory(null)}>
                  Back to Categories
                </button>
              ) : null}
              {paletteMode === 'workouts' && (hasWorkoutSearch || workoutPaletteView === 'all') && filteredWorkouts.length === 0 ? <p className="portal-muted-text">No workouts match.</p> : null}
              {paletteMode === 'workouts' && !hasWorkoutSearch && workoutPaletteView === 'categories' && !selectedWorkoutCategory && workoutCategories.length === 0 ? (
                <p className="portal-muted-text">No workout categories match.</p>
              ) : null}
              {paletteMode === 'workouts' && !hasWorkoutSearch && workoutPaletteView === 'categories' && selectedWorkoutCategory && selectedCategoryWorkouts.length === 0 ? (
                <p className="portal-muted-text">No workouts in this category.</p>
              ) : null}
              {paletteMode === 'templates' && filteredTemplates.length === 0 ? (
                <p className="portal-muted-text">{templatesLoading ? 'Loading templates...' : 'No templates yet.'}</p>
              ) : null}
            </div>
          </div>
        </aside>
        ) : null}

        <section
          className="portal-schedule-calendar"
          aria-busy={loading}
          data-throwing-export-root={builderMode === 'schedule' && view === 'throwing' ? 'true' : undefined}
          ref={builderMode === 'schedule' && view === 'throwing' ? throwingCalendarRef : undefined}
          style={builderMode === 'schedule' && (view === 'throwing' || view === 'bullpens' || view === 'velocity' || view === 'drills') ? { gridColumn: '1 / -1', width: '100%' } : undefined}
        >
          {builderMode === 'schedule' && view !== 'drills' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.45rem' }}>
              <h3 className="portal-schedule-period">{periodLabel}</h3>
              {view !== 'cycle' && view !== 'bullpens' && view !== 'velocity' && !(view === 'throwing' && throwingBuilderMode === 'weeks') && (
                <div className="portal-schedule-nav">
                  <button type="button" className="btn btn-ghost" onClick={() => movePeriod(-1)} aria-label="Previous period">
                    ←
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => movePeriod(1)} aria-label="Next period">
                    →
                  </button>
                </div>
              )}
            </div>
          ) : builderMode !== 'schedule' ? (
            <h3 className="portal-schedule-period">Template Calendar</h3>
          ) : null}
          {builderMode === 'schedule' && view !== 'day' && view !== 'cycle' && view !== 'throwing' && view !== 'bullpens' && view !== 'velocity' && view !== 'drills' && (
            <div
              data-schedule-weekdays="true"
              className={`portal-schedule-weekdays${view === 'week' ? ' is-week' : ''}`}
              style={{
                borderTop: '1px solid var(--calendar-grid-border, var(--border))',
                borderLeft: '1px solid var(--calendar-grid-border, var(--border))',
              }}
            >
              {WEEKDAY_LABELS.map((label) => (
                <span
                  key={label}
                  style={{
                    borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                    borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                    padding: view === 'week' ? '0.06rem 0.16rem' : '0.35rem 0.25rem',
                    lineHeight: 1.05,
                    fontSize: view === 'week' ? '0.66rem' : undefined,
                    whiteSpace: view === 'week' ? 'nowrap' : undefined,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          {builderMode === 'schedule' &&
            view === 'throwing' &&
            (throwingBuilderMode === 'weeks' || throwingCalendarView !== 'day') && (
            <div
              data-throwing-weekdays="true"
              className="portal-schedule-weekdays is-week"
              style={{
                borderTop: '1px solid var(--calendar-grid-border, var(--border))',
                borderLeft: '1px solid var(--calendar-grid-border, var(--border))',
                display: 'grid',
                gridTemplateColumns:
                  throwingBuilderMode === 'weeks'
                    ? '52px repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)'
                    : 'repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)',
              }}
            >
              {[
                ...(throwingBuilderMode === 'weeks' ? [''] : []),
                ...WEEKDAY_LABELS,
                'Notes',
              ].map((label, idx) => (
                <span
                  key={`${label}-${idx}`}
                  style={{
                    borderLeft: throwingBuilderMode === 'weeks' && idx === 0 ? '1px solid var(--calendar-grid-border, var(--border))' : undefined,
                    borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                    borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                    padding: '0.35rem 0.25rem',
                    lineHeight: 1.05,
                    textAlign: 'center',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          {builderMode === 'schedule' && (view === 'bullpens' || view === 'velocity') && !playerId && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(200,16,46,0.12)', border: '1px solid rgba(200,16,46,0.35)', color: '#f8fafc', fontSize: 13, marginBottom: 8 }}>
              No player selected — changes here update the <strong>shared templates</strong> visible to all players.
            </div>
          )}
          {builderMode === 'schedule' && (view === 'bullpens' || view === 'velocity') && !scriptTemplateBuilderCollapsed && (
            <div
              className="portal-panel"
              style={{
                minHeight: 'unset',
                padding: '0.75rem',
                borderRadius: 10,
                border: '1px solid var(--calendar-grid-border, var(--border))',
                background: 'rgba(0,0,0,0.16)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '56px 1fr 56px',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.6rem',
                }}
              >
                <img
                  src={schoolLogoSrc ?? '/pitching-coach-u-logo.png'}
                  alt={schoolLogoSrc ? schoolLogoAlt : `${schoolCode} logo`}
                  style={{ width: 48, height: 48, objectFit: 'contain', justifySelf: 'start' }}
                />
                <h3
                  style={{
                    margin: 0,
                    textAlign: 'center',
                    fontSize: '1.05rem',
                    fontWeight: 800,
                    letterSpacing: '0.01em',
                  }}
                >
                  {activeCurrent.title.trim() || (view === 'velocity' ? 'Velocity Script' : 'Bullpen Script')}
                </h3>
                <img
                  src="/pitching-coach-u-logo.png"
                  alt="PCU logo"
                  style={{ width: 48, height: 48, objectFit: 'contain', justifySelf: 'end' }}
                />
              </div>
              <div style={{ overflowX: 'auto' }}>
                {(isVelocityView ? velocityNotes : bullpenNotes).trim() ? (
                  <div className="portal-muted-text" style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                    {(isVelocityView ? velocityNotes : bullpenNotes).trim()}
                  </div>
                ) : null}
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                  <thead>
                    <tr>
                      {['Pitch #', ...activeCurrent.columns.map((value) => value.trim() || 'Column')].map((label) => (
                        <th
                          key={label}
                          style={{
                            textAlign: 'center',
                            fontSize: '0.98rem',
                            fontWeight: 800,
                            padding: '0.4rem 0.35rem',
                            borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                            borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {buildBullpenRows(activeCurrent.rowCount, activeCurrent.columns.length, activeCurrent.rows).map((row, idx) => (
                      <tr key={`bp-row-${idx}`} style={{ height: 46 }}>
                        <td
                          style={{
                            textAlign: 'center',
                            fontWeight: 700,
                            padding: '0.16rem',
                            height: 46,
                            verticalAlign: 'middle',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {idx + 1}
                        </td>
                        {activeCurrent.columns.map((_, fieldIdx) => (
                          <td
                            key={`bp-cell-${idx}-${fieldIdx}`}
                            style={{
                              padding: '0.16rem',
                              height: 46,
                              verticalAlign: 'middle',
                              textAlign: 'center',
                              borderBottom: '1px solid rgba(255,255,255,0.1)',
                              borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                            }}
                            onMouseEnter={() => {
                              if (!bullpenFillDrag) return;
                              bullpenFillTargetsRef.current.add(`${idx}__${fieldIdx}`);
                            }}
                          >
                            <div style={{ position: 'relative' }}>
                              <input
                                className="portal-schedule-control"
                                value={row[fieldIdx] ?? ''}
                                onChange={(event) => updateBullpenCell(idx, fieldIdx, event.target.value)}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('text/plain', row[fieldIdx] ?? '');
                                  event.dataTransfer.setData('application/x-bullpen-row', String(idx));
                                  event.dataTransfer.setData('application/x-bullpen-field', String(fieldIdx));
                                  event.dataTransfer.effectAllowed = 'copy';
                                }}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = 'copy';
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  const sourceRow = Number(event.dataTransfer.getData('application/x-bullpen-row'));
                                  const sourceField = Number(event.dataTransfer.getData('application/x-bullpen-field'));
                                  if (Number.isFinite(sourceRow) && Number.isFinite(sourceField)) {
                                    copyBullpenCell(sourceRow, sourceField, idx, fieldIdx);
                                    return;
                                  }
                                  const textValue = event.dataTransfer.getData('text/plain');
                                  if (textValue) updateBullpenCell(idx, fieldIdx, textValue);
                                }}
                                style={{
                                  width: '100%',
                                  height: 34,
                                  minHeight: 34,
                                  boxSizing: 'border-box',
                                  display: 'block',
                                  minWidth:
                                    fieldIdx === activeCurrent.columns.length - 1
                                      ? 260
                                      : fieldIdx === activeCurrent.columns.length - 2
                                        ? 180
                                        : fieldIdx === 2
                                          ? 120
                                          : 95,
                                  borderRadius: 7,
                                  padding: '0 0.45rem',
                                  textAlign: 'center',
                                  fontSize: '1.02rem',
                                  lineHeight: '34px',
                                  fontWeight: 600,
                                }}
                              />
                              <button
                                type="button"
                                aria-label="Fill value"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  bullpenFillTargetsRef.current = new Set([`${idx}__${fieldIdx}`]);
                                  setBullpenFillDrag({ sourceRow: idx, sourceField: fieldIdx, value: String(row[fieldIdx] ?? '') });
                                }}
                                style={{
                                  position: 'absolute',
                                  right: 3,
                                  bottom: 3,
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  border: '1px solid rgba(148,163,184,0.8)',
                                  background: 'rgba(248,250,252,0.92)',
                                  cursor: 'crosshair',
                                  padding: 0,
                                }}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {builderMode === 'schedule' && view === 'bullpens' && playerId > 0 && bullpenTemplates.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 14, color: '#94a3b8' }}>Player Bullpen Entry</h4>
              <BullpenEntry
                templates={bullpenTemplates}
                state={{ selectedTemplateId: selectedBullpenTemplateId, visibleTemplateIds: visibleBullpenTemplateIds }}
                playerId={playerId}
                previewQuery={`?previewPlayerId=${playerId}`}
              />
            </div>
          )}
          {builderMode === 'schedule' && view === 'drills' && (
            <div className="portal-drills-sections">
              <section className="portal-drills-note-section">
                <label>
                  <strong>Player Note</strong>
                  <textarea
                    ref={drillsNoteTextareaRef}
                    className="portal-schedule-control"
                    rows={2}
                    placeholder="Notes for this player's plyos and drills..."
                    value={drillsNotes}
                    onChange={(event) => {
                      setDrillsNotes(event.target.value);
                      requestAnimationFrame(resizeDrillsNoteTextarea);
                    }}
                  />
                </label>
              </section>
              {renderDrillSection('pre')}
              {renderDrillSection('post')}
              <section className="portal-panel" style={{ marginTop: '1rem', gridColumn: '1 / -1', width: '100%', paddingBottom: '0.6rem' }}>
                <h4 style={{ marginTop: 0 }}>Catch Play Drills and Routine</h4>
                <p className="portal-muted-text" style={{ marginBottom: '0.6rem' }}>
                  These notes will display for this player when they open a Throwing (High) or Throwing (Medium) workout.
                </p>
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <strong>High Day</strong>
                    <textarea
                      className="portal-schedule-control"
                      rows={3}
                      placeholder="Catch play routine for High days..."
                      value={catchPlayHighDay}
                      onChange={(event) => setCatchPlayHighDay(event.target.value)}
                      style={{ width: '100%', resize: 'vertical', fontSize: '1rem' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <strong>Medium Day</strong>
                    <textarea
                      className="portal-schedule-control"
                      rows={3}
                      placeholder="Catch play routine for Medium days..."
                      value={catchPlayMediumDay}
                      onChange={(event) => setCatchPlayMediumDay(event.target.value)}
                      style={{ width: '100%', resize: 'vertical', fontSize: '1rem' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <strong>Low Day</strong>
                    <textarea
                      className="portal-schedule-control"
                      rows={3}
                      placeholder="Catch play routine for Low days..."
                      value={catchPlayLowDay}
                      onChange={(event) => setCatchPlayLowDay(event.target.value)}
                      style={{ width: '100%', resize: 'vertical', fontSize: '1rem' }}
                    />
                  </label>
                </div>
              </section>
            </div>
          )}
          {builderMode === 'schedule' && view === 'month' && (
            <div
              className="portal-schedule-month-grid"
              style={{
                borderLeft: '1px solid var(--calendar-grid-border, var(--border))',
              }}
            >
              {monthCells.map((date) => renderDayCell(date, true, visibleRange.monthStart))}
            </div>
          )}
          {builderMode === 'schedule' && view === 'throwing' && throwingBuilderMode === 'month' && throwingCalendarView === 'month' && (
            <div style={{ display: 'grid', gap: 0, borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
              {throwingWeeks.map((week, weekIdx) => {
                const firstDate = week[0];
                const weekStart = startOfWeek(firstDate);
                return (
                  <div
                    data-throwing-week="true"
                    key={`throwing-week-${weekStart}-${weekIdx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)',
                      gap: 0,
                    }}
                  >
                    {week.map((date, index) => renderThrowingDay(date, `throwing-${date}-${index}`))}
                    <article
                      className="portal-schedule-day portal-throwing-cell"
                      style={{
                        minHeight: '182px',
                        aspectRatio: 'auto',
                        borderRadius: 0,
                        borderTop: 0,
                        borderLeft: 0,
                        borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                        borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                      }}
                    >
                      <div className="portal-schedule-day-head" style={{ visibility: 'hidden' }}>
                        <span className="portal-schedule-day-num">00</span>
                      </div>
                      <div className="portal-schedule-day-body" style={{ display: 'grid', alignContent: 'start', overflow: 'hidden', margin: 0 }}>
                        <textarea
                          className="portal-throwing-notes"
                          rows={7}
                          placeholder="Notes..."
                          value={throwingWeekNotes[weekStart] ?? ''}
                          onChange={(event) =>
                            setThrowingWeekNotes((prev) => ({
                              ...prev,
                              [weekStart]: event.target.value,
                            }))
                          }
                          style={throwingNotesStyle}
                        />
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
          )}
          {builderMode === 'schedule' && view === 'throwing' && throwingBuilderMode === 'month' && throwingCalendarView === 'week' && (
            <div style={{ display: 'grid', gap: 0, borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
              <div
                data-throwing-week="true"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)',
                  gap: 0,
                }}
              >
                {throwingWeekCells.map((date, index) => renderThrowingDay(date, `throwing-week-${date}-${index}`))}
                <article
                  className="portal-schedule-day portal-throwing-cell"
                  style={{
                    minHeight: '182px',
                    aspectRatio: 'auto',
                    borderRadius: 0,
                    borderTop: 0,
                    borderLeft: 0,
                    borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                    borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                  }}
                >
                  <div className="portal-schedule-day-head" style={{ visibility: 'hidden' }}>
                    <span className="portal-schedule-day-num">00</span>
                  </div>
                  <div className="portal-schedule-day-body" style={{ display: 'grid', alignContent: 'start', overflow: 'hidden', margin: 0 }}>
                    <textarea
                      className="portal-throwing-notes"
                      rows={7}
                      placeholder="Notes..."
                      value={throwingWeekNotes[startOfWeek(throwingWeekCells[0] ?? anchorDate)] ?? ''}
                      onChange={(event) =>
                        setThrowingWeekNotes((prev) => ({
                          ...prev,
                          [startOfWeek(throwingWeekCells[0] ?? anchorDate)]: event.target.value,
                        }))
                      }
                      style={throwingNotesStyle}
                    />
                  </div>
                </article>
              </div>
            </div>
          )}
          {builderMode === 'schedule' && view === 'throwing' && throwingBuilderMode === 'month' && throwingCalendarView === 'day' && (
            <div style={{ maxWidth: 420, borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
              {throwingDayCells.map((date, index) => renderThrowingDay(date, `throwing-day-${date}-${index}`))}
            </div>
          )}
          {builderMode === 'schedule' && view === 'throwing' && throwingBuilderMode === 'weeks' && (
            <div style={{ display: 'grid', gap: 0, borderLeft: '1px solid var(--calendar-grid-border, var(--border))' }}>
              {throwingTemplateWeeks.map((weekIdx) => {
                const weekKey = `week-${weekIdx + 1}`;
                return (
                  <div
                    data-throwing-week="true"
                    key={`throwing-template-week-${weekIdx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '52px repeat(7, minmax(0, 1fr)) minmax(220px, 1.35fr)',
                      gap: 0,
                    }}
                  >
                    <article
                      className="portal-schedule-day portal-throwing-cell portal-throwing-week-rail"
                      style={{
                        minHeight: '182px',
                        aspectRatio: 'auto',
                        borderRadius: 0,
                        borderTop: 0,
                        borderLeft: '1px solid var(--calendar-grid-border, var(--border))',
                        borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                        borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.4rem 0.2rem',
                      }}
                    >
                      <div
                        className="portal-throwing-week-label"
                        style={{
                          lineHeight: 1.05,
                          fontSize: '1.1rem',
                          fontWeight: 800,
                          letterSpacing: '0.035em',
                          textAlign: 'center',
                          whiteSpace: 'pre-line',
                          width: '100%',
                        }}
                      >
                        {`W\nE\nE\nK\n\n${weekIdx + 1}`}
                      </div>
                    </article>
                    {Array.from({ length: 7 }, (_, dayIdx) => renderThrowingTemplateDay(weekIdx, dayIdx))}
                    <article
                      className="portal-schedule-day portal-throwing-cell"
                      style={{
                        minHeight: '182px',
                        aspectRatio: 'auto',
                        borderRadius: 0,
                        borderTop: 0,
                        borderLeft: 0,
                        borderRight: '1px solid var(--calendar-grid-border, var(--border))',
                        borderBottom: '1px solid var(--calendar-grid-border, var(--border))',
                      }}
                    >
                      <div className="portal-schedule-day-head">
                        <span className="portal-schedule-day-num" />
                      </div>
                      <div
                        className="portal-schedule-day-body"
                        style={{
                          display: 'grid',
                          alignContent: 'start',
                          overflow: 'hidden',
                          margin: 0,
                          gap: '0.28rem',
                          paddingRight: 0,
                        }}
                      >
                        <textarea
                          className="portal-throwing-notes"
                          rows={7}
                          placeholder="Notes..."
                          value={throwingTemplateWeekNotes[weekKey] ?? ''}
                          onChange={(event) =>
                            setThrowingTemplateWeekNotes((prev) => ({
                              ...prev,
                              [weekKey]: event.target.value,
                            }))
                          }
                          style={throwingNotesStyle}
                        />
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
          )}
          {builderMode === 'schedule' && view === 'week' && (
            <div
              className="portal-schedule-week-grid"
              style={{
                borderLeft: '1px solid var(--calendar-grid-border, var(--border))',
                marginTop: 0,
                paddingTop: 0,
              }}
            >
              {visibleWeekCells.map((date) => renderDayCell(date, false, undefined, false))}
            </div>
          )}
          {builderMode === 'schedule' && view === 'day' && <div className="portal-schedule-day-grid">{dayCells.map((date) => renderDayCell(date, false, undefined, true))}</div>}
          {builderMode === 'schedule' && view === 'cycle' && (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <label className="portal-cycle-notes-panel">
                <span>3-Day Cycle Notes</span>
                <textarea
                  className="portal-schedule-control"
                  rows={3}
                  value={cycleNotes}
                  onChange={(event) => setCycleNotes(event.target.value)}
                  placeholder="Write notes for player..."
                />
              </label>
              <div
                className="portal-cycle-grid"
                style={{
                  gap: '0.75rem',
                }}
              >
                {CYCLE_COLUMNS.map((column) => (
                  <article
                    key={column.key}
                    className="portal-panel"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void onCycleDrop(event, column.key)}
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest('.portal-schedule-item')) return;
                      setCycleMenu({ cycleSlot: column.key, x: event.clientX, y: event.clientY });
                    }}
                    style={{ minHeight: '320px' }}
                  >
                    <h4 style={{ marginTop: 0 }}>{column.label}</h4>
                    <div style={{ display: 'grid', gap: '0.45rem' }}>
                      {cycleItemsBySlot[column.key].map((item) => (
                        <div key={item.itemId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="checkbox"
                            checked={selectedItemIds.has(item.itemId)}
                            onChange={(event) => {
                              event.stopPropagation();
                              setSelectedItemIds((prev) => {
                                const next = new Set(prev);
                                if (event.target.checked) next.add(item.itemId);
                                else next.delete(item.itemId);
                                return next;
                              });
                            }}
                            style={{ flexShrink: 0, accentColor: '#c8102e', cursor: 'pointer' }}
                          />
                          <button
                            type="button"
                            className="portal-schedule-item"
                            title={item.itemName}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'center',
                              color: 'var(--text-main)',
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: 'var(--calendar-grid-border, var(--border))',
                              borderRadius: '6px',
                              padding: '0.28rem 0.42rem',
                              ...categoryBubbleStyle(item.workoutCategory ?? 'Workout'),
                              ...(selectedItemIds.has(item.itemId) ? { borderColor: '#c8102e' } : {}),
                            }}
                            draggable={!selectedItemIds.has(item.itemId)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('cycleItemId', String(item.itemId));
                              event.dataTransfer.setData('cycleItemSlot', item.cycleSlot ?? '');
                            }}
                            onClick={() => {
                              if (selectedItemIds.size > 0) {
                                setSelectedItemIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.itemId)) next.delete(item.itemId);
                                  else next.add(item.itemId);
                                  return next;
                                });
                                return;
                              }
                              const linkTarget = getCalendarLinkTarget(item);
                              if (linkTarget === 'throwing') {
                                setView('throwing');
                                setThrowingBuilderMode('month');
                                setThrowingCalendarView('day');
                                return;
                              }
                              if (linkTarget === 'bullpens') {
                                setView('bullpens');
                                return;
                              }
                              if (linkTarget === 'velocity') {
                                setView('velocity');
                                return;
                              }
                              if (linkTarget === 'drills') {
                                setView('drills');
                                return;
                              }
                              setSelectedItem(item);
                            }}
                          >
                            <strong>{item.itemName}</strong>
                          </button>
                        </div>
                      ))}
                      {cycleItemsBySlot[column.key].length === 0 && (
                        <p className="portal-muted-text" style={{ margin: 0 }}>
                          Drag workouts here
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          {builderMode === 'template' ? (
            <div>
              <div className="portal-schedule-weekdays is-week">
                {WEEKDAY_LABELS.map((label) => (
                  <span key={`template-weekday-${label}`}>{label}</span>
                ))}
              </div>
              <div className="portal-schedule-month-grid" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                {templateGridOffsets.map((offset) => {
                  const dayItems = templateDayItems[offset] ?? [];
                  const weekNumber = Math.floor(offset / 7) + 1;
                  const dayIndex = (offset % 7) + 1;
                  return (
                    <article
                      key={`template-day-${offset}`}
                      className="portal-schedule-day"
                      style={{ minHeight: 150 }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onTemplateDayDrop(event, offset)}
                    >
                      <header>
                        <strong>{`W${weekNumber}D${dayIndex}`}</strong>
                      </header>
                      <div className="portal-schedule-day-body" style={{ display: 'grid', gap: '0.25rem' }}>
                        {dayItems.map((item, index) => (
                          <button
                            key={`template-${offset}-${item.workoutId}-${index}`}
                            type="button"
                            className="portal-schedule-item"
                            style={{
                              display: 'grid',
                              gap: 4,
                              textAlign: 'left',
                              ...categoryBubbleStyle(item.workoutCategory ?? 'Workout'),
                            }}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.setData('templateDayOffset', String(offset));
                              event.dataTransfer.setData('templateDayItemIndex', String(index));
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => onTemplateItemDrop(event, offset, index)}
                          >
                            <span style={{ fontWeight: 700 }}>{item.workoutName}</span>
                            <span
                              style={{ fontSize: '0.72rem', textDecoration: 'underline' }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                removeTemplateDayItem(offset, index);
                              }}
                            >
                              Remove
                            </span>
                          </button>
                        ))}
                        {dayItems.length === 0 ? <p className="portal-muted-text" style={{ margin: 0 }}>Drag workout here</p> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {error && <p className="auth-error">{error}</p>}

      {/* Bulk action bar */}
      {selectedItemIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(10,12,18,0.97)', border: '1px solid rgba(200,16,46,0.5)',
          borderRadius: 12, padding: '10px 18px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
            {selectedItemIds.size} workout{selectedItemIds.size > 1 ? 's' : ''} selected
          </span>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }}
            onClick={() => setBulkReplaceOpen(true)}>
            Replace
          </button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 13, color: '#ef4444' }}
            onClick={() => { if (window.confirm(`Delete ${selectedItemIds.size} workout${selectedItemIds.size > 1 ? 's' : ''}?`)) void bulkDeleteItems(); }}>
            Delete
          </button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12, opacity: 0.7 }}
            onClick={() => setSelectedItemIds(new Set())}>
            Cancel
          </button>
        </div>
      )}

      {/* Bulk replace modal */}
      {bulkReplaceOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { setBulkReplaceOpen(false); setBulkReplaceQuery(''); }}>
          <div style={{ background: 'rgba(10,12,18,0.99)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14, padding: 20, width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 12 }}
            onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: 0, fontSize: 15, color: '#e2e8f0' }}>
              Replace {selectedItemIds.size} workout{selectedItemIds.size > 1 ? 's' : ''} with:
            </h4>
            <input
              className="portal-schedule-control"
              placeholder="Search workouts..."
              value={bulkReplaceQuery}
              onChange={(e) => setBulkReplaceQuery(e.target.value)}
              autoFocus
            />
            <div style={{ overflowY: 'auto', display: 'grid', gap: 4, flex: 1 }}>
              {workouts
                .filter((w) => !bulkReplaceQuery.trim() || w.name.toLowerCase().includes(bulkReplaceQuery.trim().toLowerCase()))
                .slice(0, 60)
                .map((w) => (
                  <button key={w.id} type="button" className="btn btn-ghost"
                    style={{ textAlign: 'left', fontSize: 13, padding: '6px 10px' }}
                    onClick={() => void bulkReplaceItems(w.id)}>
                    {w.name}
                    {w.category ? <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b' }}>{w.category}</span> : null}
                  </button>
                ))}
              {workouts.filter((w) => !bulkReplaceQuery.trim() || w.name.toLowerCase().includes(bulkReplaceQuery.trim().toLowerCase())).length === 0 && (
                <p className="portal-muted-text" style={{ margin: 0, fontSize: 13 }}>No workouts found.</p>
              )}
            </div>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }}
              onClick={() => { setBulkReplaceOpen(false); setBulkReplaceQuery(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {selectedItem && (
        <WorkoutLogModal
          item={selectedItem}
          playerId={playerId}
          onClose={() => setSelectedItem(null)}
          onSaved={async () => {
            await loadItems();
          }}
          allowWorkoutCustomization={selectedItem.scheduleType === 'calendar' && selectedItem.itemType === 'workout'}
          exerciseOptions={exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            category: exercise.category,
          }))}
          onWorkoutCustomized={async (item) => {
            setSelectedItem(item);
            setItems((previous) => previous.map((current) => (current.itemId === item.itemId ? item : current)));
          }}
          onDelete={
            selectedItem.scheduleType === 'calendar' || selectedItem.scheduleType === 'cycle'
              ? async (item) => {
                  if (!window.confirm(`Delete "${item.itemName}"?`)) return;
                  if (item.scheduleType === 'cycle') await deleteCycleItem(item.itemId);
                  else await deleteCalendarItem(item.itemId);
                }
              : undefined
          }
          catchPlayNote={
            selectedItem.cycleSlot === 'high' || /\bhigh\b/i.test(selectedItem.itemName) ? catchPlayHighDay
              : selectedItem.cycleSlot === 'medium' || /\bmedium\b/i.test(selectedItem.itemName) ? catchPlayMediumDay
              : selectedItem.cycleSlot === 'low' || /\blow\b/i.test(selectedItem.itemName) ? catchPlayLowDay
              : undefined
          }
        />
      )}

      {menu && (
        <div
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 80,
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: '10px',
            background: 'rgba(0,0,0,0.95)',
            padding: '0.35rem',
            display: 'grid',
            gap: '0.25rem',
            minWidth: '170px',
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="btn btn-ghost" onClick={() => copyDay(menu.dayDate)}>
            Copy Day
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => copyWeekFromDay(menu.dayDate)}>
            Copy Week
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const ok = window.confirm(`Delete all workouts on ${menu.dayDate}?`);
              if (!ok) return;
              void clearCalendarDay(menu.dayDate);
              setMenu(null);
            }}
          >
            Delete Day
          </button>
          {copiedPlan && (
            <button type="button" className="btn btn-primary" onClick={() => void pasteCopiedPlan(menu.dayDate)}>
              Paste
            </button>
          )}
        </div>
      )}

      {cycleMenu && (
        <div
          style={{
            position: 'fixed',
            left: cycleMenu.x,
            top: cycleMenu.y,
            zIndex: 80,
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: '10px',
            background: 'rgba(0,0,0,0.95)',
            padding: '0.35rem',
            display: 'grid',
            gap: '0.25rem',
            minWidth: '180px',
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="btn btn-ghost" onClick={() => copyCycleSlot(cycleMenu.cycleSlot)}>
            Copy Column
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const ok = window.confirm('Delete all workouts in this cycle column?');
              if (!ok) return;
              void clearCycleSlot(cycleMenu.cycleSlot);
              setCycleMenu(null);
            }}
          >
            Delete Column
          </button>
          {copiedCycle && (
            <button type="button" className="btn btn-primary" onClick={() => void pasteCycleSlot(cycleMenu.cycleSlot)}>
              Paste Column
            </button>
          )}
        </div>
      )}

      {throwingMenu && (
        <div
          style={{
            position: 'fixed',
            left: throwingMenu.x,
            top: throwingMenu.y,
            zIndex: 80,
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: '10px',
            background: 'rgba(0,0,0,0.95)',
            padding: '0.35rem',
            display: 'grid',
            gap: '0.25rem',
            minWidth: '170px',
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {throwingMenu.mode === 'month' ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => copyThrowingDayMonth(throwingMenu.date)}>
                Copy Day
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => copyThrowingWeekMonth(throwingMenu.date)}>
                Copy Week
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => clearThrowingDayMonth(throwingMenu.date)}>
                Delete Day
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => clearThrowingWeekMonth(throwingMenu.date)}>
                Delete Week
              </button>
              {copiedThrowing && (
                <button type="button" className="btn btn-primary" onClick={() => pasteThrowingMonth(throwingMenu.date)}>
                  Paste
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => copyThrowingDayTemplate(throwingMenu.weekIndex, throwingMenu.dayIndex)}>
                Copy Day
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => copyThrowingWeekTemplate(throwingMenu.weekIndex, throwingMenu.dayIndex)}>
                Copy Week
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => clearThrowingDayTemplate(throwingMenu.weekIndex, throwingMenu.dayIndex)}>
                Delete Day
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => clearThrowingWeekTemplate(throwingMenu.weekIndex, throwingMenu.dayIndex)}>
                Delete Week
              </button>
              {copiedThrowing && (
                <button type="button" className="btn btn-primary" onClick={() => pasteThrowingTemplate(throwingMenu.weekIndex, throwingMenu.dayIndex)}>
                  Paste
                </button>
              )}
            </>
          )}
        </div>
      )}
      {drillVideoPreview ? (
        <div
          className="portal-modal-backdrop"
          role="presentation"
          onClick={() => setDrillVideoPreview(null)}
        >
          <article
            className="portal-modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: '820px', width: '92vw' }}
          >
            <div className="portal-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0 }}>{drillVideoPreview.title}</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setDrillVideoPreview(null)}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10, position: 'relative', width: '100%', paddingTop: '56.25%' }}>
              <iframe
                src={drillVideoPreview.url}
                title={drillVideoPreview.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, borderRadius: 8 }}
              />
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}
