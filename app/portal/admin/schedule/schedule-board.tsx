'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ProgramItemRow } from '../../../../lib/training-db';
import WorkoutLogModal from '../../components/workout-log-modal';

type PlayerChoice = { id: number; name: string };
type WorkoutChoice = { id: number; name: string; exerciseCount: number; category: string };
type ViewMode = 'day' | 'week' | 'month' | 'cycle' | 'throwing';
type ThrowingBuilderMode = 'month' | 'weeks';
type ThrowingCalendarView = 'day' | 'week' | 'month';
type BuilderMode = 'schedule' | 'template';
type PaletteMode = 'workouts' | 'templates';
type WorkoutPaletteView = 'all' | 'categories';
type ThrowingDayEntry = { intensity: string; distance: string; throwsText: string; bullpen: string };
type ThrowingTemplate = {
  id: string;
  name: string;
  weekCount: number;
  byCell: Record<string, ThrowingDayEntry>;
  weekNotes: Record<string, string>;
  updatedAt: string;
};
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
const CYCLE_COLUMNS: Array<{ key: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c'; label: string }> = [
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'low', label: 'Low' },
  { key: 'mobility', label: 'Mobility' },
  { key: 's_and_c', label: 'S&C' },
];
const SCHEDULE_REQUEST_TIMEOUT_MS = 20000;

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

export default function ScheduleBoard({ players, workouts }: ScheduleBoardProps) {
  const [playerId, setPlayerId] = useState<number>(players[0]?.id ?? 0);
  const [playerQuery, setPlayerQuery] = useState(players[0]?.name ?? '');
  const [showPlayerSuggestions, setShowPlayerSuggestions] = useState(false);
  const [isMobilePlayerPicker, setIsMobilePlayerPicker] = useState(false);
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
  const [copiedPlan, setCopiedPlan] = useState<CopiedPlanBuffer | null>(null);
  const [copiedThrowing, setCopiedThrowing] = useState<ThrowingCopiedBuffer | null>(null);
  const [menu, setMenu] = useState<{ dayDate: string; x: number; y: number } | null>(null);
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
  const throwingCalendarRef = useRef<HTMLDivElement | null>(null);
  const throwingStateLoadedRef = useRef(false);

  const resetTemplateDraft = () => {
    setSelectedTemplateId(null);
    setTemplateName('');
    setTemplateWeekCount(4);
    setTemplateDayItems({});
  };

  const filteredPlayers = useMemo(() => {
    const q = playerQuery.trim().toLowerCase();
    if (!q) return players;
    return players.filter((player) => player.name.toLowerCase().includes(q));
  }, [playerQuery, players]);

  useEffect(() => {
    const selected = players.find((player) => player.id === playerId);
    if (!selected) return;
    setPlayerQuery(selected.name);
  }, [playerId, players]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 780px)');
    const sync = () => setIsMobilePlayerPicker(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 780px)');
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
    if (view === 'throwing') {
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
        setThrowingByDate({});
        setThrowingWeekNotes({});
        setThrowingTemplates([]);
        setSelectedThrowingTemplateId('');
        setThrowingTemplateName('');
        setThrowingTemplateWeekCount(4);
        setThrowingTemplateByCell({});
        setThrowingTemplateWeekNotes({});
        return;
      }
      try {
        const response = await fetchWithTimeout(`/api/admin/schedule/throwing?playerId=${playerId}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as {
          byDate?: Record<string, ThrowingDayEntry>;
          weekNotes?: Record<string, string>;
          templates?: ThrowingTemplate[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load throwing calendar.');
        if (cancelled) return;
        setThrowingByDate(payload.byDate ?? {});
        setThrowingWeekNotes(payload.weekNotes ?? {});
        const nextTemplates = Array.isArray(payload.templates) ? payload.templates : [];
        setThrowingTemplates(nextTemplates);
        if (nextTemplates.length > 0) {
          const first = nextTemplates[0];
          setSelectedThrowingTemplateId(first.id);
          setThrowingTemplateName(first.name);
          setThrowingTemplateWeekCount(first.weekCount);
          setThrowingTemplateByCell(first.byCell ?? {});
          setThrowingTemplateWeekNotes(first.weekNotes ?? {});
        } else {
          setSelectedThrowingTemplateId('');
          setThrowingTemplateName('');
          setThrowingTemplateWeekCount(4);
          setThrowingTemplateByCell({});
          setThrowingTemplateWeekNotes({});
        }
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
        throwingStateLoadedRef.current = true;
      }
    };
    void loadThrowingState();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    if (!playerId || !throwingStateLoadedRef.current) return;
    const handle = setTimeout(() => {
      void fetchWithTimeout('/api/admin/schedule/throwing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId,
          byDate: throwingByDate,
          weekNotes: throwingWeekNotes,
          templates: throwingTemplates,
        }),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [playerId, throwingByDate, throwingWeekNotes, throwingTemplates]);

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
  const emptyThrowingEntry: ThrowingDayEntry = { intensity: '', distance: '', throwsText: '', bullpen: '' };
  const hasThrowingEntry = (entry: ThrowingDayEntry | undefined): boolean =>
    Boolean(
      entry &&
        (String(entry.intensity ?? '').trim() ||
          String(entry.distance ?? '').trim() ||
          String(entry.throwsText ?? '').trim() ||
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
    }
    else if (view === 'week') setAnchorDate((prev) => addDays(prev, direction * 7));
    else {
      const date = fromIsoDate(anchorDate);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchorDate(toIsoDate(date));
    }
  };

  const jumpToCurrentForView = (mode: ViewMode) => {
    if (mode === 'day' || mode === 'week' || mode === 'cycle' || mode === 'throwing') {
      setAnchorDate(toIsoDate(new Date()));
    }
  };

  const downloadThrowingCalendar = async () => {
    if (view !== 'throwing') return;
    const node = throwingCalendarRef.current;
    if (!node) return;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const renderCanvas = async (el: HTMLElement) =>
        html2canvas(el, {
          backgroundColor: '#05060a',
          scale: 2,
          useCORS: true,
          onclone: (doc) => {
            const clonedRoot = doc.body.querySelector('[data-throwing-export-root="true"]');
            if (!clonedRoot) return;
            const fields = clonedRoot.querySelectorAll('input[placeholder], textarea[placeholder]');
            fields.forEach((field) => {
              field.removeAttribute('placeholder');
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
        pdf.setFillColor(5, 6, 10);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
      };

      const drawCenteredHeader = () => {
        pdf.setTextColor(255, 255, 255);
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

  const assignCycleWorkout = async (cycleSlot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c', workoutId: number) => {
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

  const moveCycleItem = async (itemId: number, cycleSlot: 'medium' | 'high' | 'low' | 'mobility' | 's_and_c') => {
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

  const parseIntensityValue = (raw: string): number | null => {
    const match = String(raw ?? '').match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
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
    if (!menu && !throwingMenu) return;
    const onPointerDown = () => setMenu(null);
    const onThrowingPointerDown = () => setThrowingMenu(null);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerdown', onThrowingPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerdown', onThrowingPointerDown);
    };
  }, [menu, throwingMenu]);

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
    const sourceOffset = Number(event.dataTransfer.getData('templateDayOffset'));
    const sourceIndex = Number(event.dataTransfer.getData('templateDayItemIndex'));
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
          minHeight: view === 'week' ? '128px' : '220px',
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
        <div className="portal-schedule-day-body" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.3rem' }}>
          {dayItems.map((item) => (
            <button
              key={item.itemId}
              type="button"
              className="portal-schedule-item"
              title={item.itemName}
              style={{
                display: 'block',
                width: 'calc(100% - 0.35rem)',
                margin: '0 auto',
                boxSizing: 'border-box',
                textAlign: 'center',
                color: 'var(--text-main)',
                border: '1px solid var(--calendar-grid-border, var(--border))',
                borderRadius: '6px',
                padding: '0.24rem 0.4rem',
                ...categoryBubbleStyle(item.workoutCategory ?? item.exerciseCategory ?? 'Workout'),
              }}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('scheduleItemId', String(item.itemId));
                event.dataTransfer.setData('scheduleItemDay', item.dayDate);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void onItemDrop(event, dayDate, item.itemId)}
              onClick={() => {
                if (isThrowingCalendarWorkoutName(item.itemName)) {
                  setAnchorDate(item.dayDate);
                  setView('throwing');
                  setThrowingBuilderMode('month');
                  setThrowingCalendarView('day');
                  return;
                }
                setSelectedItem(item);
              }}
            >
              <strong>{item.itemName}</strong>
            </button>
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
        minHeight: '220px',
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
    const entry = throwingByDate[date] ?? { intensity: '', distance: '', throwsText: '', bullpen: '' };
    const setField = (field: keyof ThrowingDayEntry, value: string) => {
      setThrowingByDate((prev) => ({
        ...prev,
        [date]: { ...(prev[date] ?? { intensity: '', distance: '', throwsText: '', bullpen: '' }), [field]: value },
      }));
    };
    return (
      <article
        key={date}
        className="portal-schedule-day portal-throwing-cell"
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
            <input className="portal-throwing-field" value={entry.intensity} onChange={(event) => setField('intensity', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Distance:</span>
            <input className="portal-throwing-field" value={entry.distance} onChange={(event) => setField('distance', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Throws:</span>
            <input className="portal-throwing-field" value={entry.throwsText} onChange={(event) => setField('throwsText', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Mound:</span>
            <input className="portal-throwing-field" value={entry.bullpen} onChange={(event) => setField('bullpen', event.target.value)} style={throwingInputBaseStyle} />
          </div>
        </div>
      </article>
    );
  };

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
      byCell: throwingTemplateByCell,
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
    setThrowingTemplateByCell(found.byCell ?? {});
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
    const entry = throwingTemplateByCell[cellKey] ?? { intensity: '', distance: '', throwsText: '', bullpen: '' };
    const setField = (field: keyof ThrowingDayEntry, value: string) => {
      setThrowingTemplateByCell((prev) => ({
        ...prev,
        [cellKey]: { ...(prev[cellKey] ?? { intensity: '', distance: '', throwsText: '', bullpen: '' }), [field]: value },
      }));
    };
    return (
      <article
        key={`throwing-template-${cellKey}`}
        className="portal-schedule-day portal-throwing-cell"
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
            <input className="portal-throwing-field" value={entry.intensity} onChange={(event) => setField('intensity', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Distance:</span>
            <input className="portal-throwing-field" value={entry.distance} onChange={(event) => setField('distance', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Throws:</span>
            <input className="portal-throwing-field" value={entry.throwsText} onChange={(event) => setField('throwsText', event.target.value)} style={throwingInputBaseStyle} />
          </div>
          <div style={throwingRowStyle}>
            <span style={throwingLabelStyle}>Mound:</span>
            <input className="portal-throwing-field" value={entry.bullpen} onChange={(event) => setField('bullpen', event.target.value)} style={throwingInputBaseStyle} />
          </div>
        </div>
      </article>
    );
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
            <label className="portal-schedule-player-picker">
              Player
              <input
                className="portal-schedule-control"
                value={playerQuery}
                onChange={(event) => {
                  setPlayerQuery(event.target.value);
                  if (isMobilePlayerPicker) setShowPlayerSuggestions(true);
                }}
                onFocus={() => {
                  if (isMobilePlayerPicker) setShowPlayerSuggestions(true);
                }}
                onBlur={() => {
                  if (isMobilePlayerPicker) setTimeout(() => setShowPlayerSuggestions(false), 120);
                  const q = playerQuery.trim().toLowerCase();
                  if (!q) {
                    const selected = players.find((player) => player.id === playerId);
                    setPlayerQuery(selected?.name ?? '');
                    return;
                  }
                  const exact = players.find((player) => player.name.trim().toLowerCase() === q);
                  if (exact) {
                    setPlayerId(exact.id);
                    setPlayerQuery(exact.name);
                    return;
                  }
                  const selected = players.find((player) => player.id === playerId);
                  setPlayerQuery(selected?.name ?? '');
                }}
                placeholder="Search player..."
                list="schedule-player-search-options"
                aria-label="Search player"
              />
              {isMobilePlayerPicker && showPlayerSuggestions && (
                <div className="portal-search-dropdown" role="listbox" aria-label="Player suggestions">
                  {(filteredPlayers.length > 0 ? filteredPlayers : players).slice(0, 24).map((player) => (
                    <button
                      key={`player-suggest-${player.id}`}
                      type="button"
                      className="portal-search-dropdown-item"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setPlayerId(player.id);
                        setPlayerQuery(player.name);
                        setShowPlayerSuggestions(false);
                      }}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
              )}
              <datalist id="schedule-player-search-options">
                {players.map((player) => (
                  <option key={player.id} value={player.name} />
                ))}
              </datalist>
            </label>
            <div className="portal-schedule-view-switch" role="group" aria-label="Calendar view">
              {(['day', 'week', 'month', 'cycle', 'throwing'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`btn ${view === mode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => {
                    jumpToCurrentForView(mode);
                    setView(mode);
                  }}
                >
                  {mode === 'cycle' ? '3-Day Cycle' : mode === 'throwing' ? 'Throwing Calendar' : `${mode[0].toUpperCase()}${mode.slice(1)}`}
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

      {isMobileSchedule && !(builderMode === 'schedule' && view === 'throwing') ? (
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
        {builderMode === 'schedule' && view === 'throwing' ? null : (!isMobileSchedule || !mobilePaletteCollapsed) ? (
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
            {paletteMode === 'workouts' && workoutQuery.trim().length > 0 && workoutSuggestions.length > 0 && (
              <div className="portal-search-dropdown" role="listbox" aria-label="Workout search suggestions">
                {workoutSuggestions.map((workout) => (
                  <button
                    key={`suggest-${workout.id}`}
                    type="button"
                    className="portal-search-option"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('workoutId', String(workout.id));
                    }}
                    onClick={() => {
                      setWorkoutQuery(workout.name);
                    }}
                  >
                    {workout.name}
                  </button>
                ))}
              </div>
            )}
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
          style={builderMode === 'schedule' && view === 'throwing' ? { gridColumn: '1 / -1', width: '100%' } : undefined}
        >
          {builderMode === 'schedule' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.45rem' }}>
              <h3 className="portal-schedule-period">{periodLabel}</h3>
              {view !== 'cycle' && !(view === 'throwing' && throwingBuilderMode === 'weeks') && (
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
          ) : (
            <h3 className="portal-schedule-period">Template Calendar</h3>
          )}
          {builderMode === 'schedule' && view !== 'day' && view !== 'cycle' && view !== 'throwing' && (
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
                          gridTemplateRows: 'repeat(4, 36px)',
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
                  style={{ minHeight: '320px' }}
                >
                  <h4 style={{ marginTop: 0 }}>{column.label}</h4>
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {cycleItemsBySlot[column.key].map((item) => (
                      <button
                        key={item.itemId}
                        type="button"
                        className="portal-schedule-item"
                        title={item.itemName}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'center',
                          color: 'var(--text-main)',
                          border: '1px solid var(--calendar-grid-border, var(--border))',
                          borderRadius: '6px',
                          padding: '0.28rem 0.42rem',
                          ...categoryBubbleStyle(item.workoutCategory ?? 'Workout'),
                        }}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('cycleItemId', String(item.itemId));
                          event.dataTransfer.setData('cycleItemSlot', item.cycleSlot ?? '');
                        }}
                        onClick={() => setSelectedItem(item)}
                      >
                        <strong>{item.itemName}</strong>
                      </button>
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

      {selectedItem && (
        <WorkoutLogModal
          item={selectedItem}
          playerId={playerId}
          onClose={() => setSelectedItem(null)}
          onSaved={async () => {
            await loadItems();
          }}
          onDelete={
            selectedItem.scheduleType === 'calendar'
              ? async (item) => {
                  if (!window.confirm(`Delete "${item.itemName}" from this day?`)) return;
                  await deleteCalendarItem(item.itemId);
                }
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
    </div>
  );
}
