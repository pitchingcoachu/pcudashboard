export type PageManifestEntry = {
  title: string;
  route: string;
  description: string;
  keywords: string[];
  roles: Array<'admin' | 'coach' | 'player'>;
};

export const PAGE_MANIFEST: PageManifestEntry[] = [
  {
    title: 'Home',
    route: '/portal/dashboard?suite=home',
    description: 'Dashboard landing page: player/team search and an alerts feed showing who is trending up or down.',
    keywords: ['home', 'search', 'alerts', 'trending'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Pitching Suite',
    route: '/portal/dashboard?suite=pitching-suite',
    description: 'Pitching analytics: velocity, movement, Stuff+/QP+/Control+, heatmaps, pitch log, leaderboards, Pitcher DNA.',
    keywords: ['pitching', 'velocity', 'stuff+', 'movement', 'heatmap', 'pitch log', 'leaderboard'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Hitting Suite',
    route: '/portal/dashboard?suite=hitting-suite',
    description: 'Hitting analytics: exit velocity, launch angle, xWOBA, barrel rate, spray charts, bat speed, contact points.',
    keywords: ['hitting', 'exit velocity', 'launch angle', 'xwoba', 'barrel', 'spray chart', 'bat speed'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Catching Suite',
    route: '/portal/dashboard?suite=catching-suite',
    description: 'Catching data and performance: framing and blocking metrics, leaderboards, heatmaps.',
    keywords: ['catching', 'framing', 'blocking'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Comparison Tool',
    route: '/portal/dashboard?suite=comparison-tool',
    description: 'Side-by-side comparison of players across pitching, hitting, or catching with configurable chart panes.',
    keywords: ['compare', 'comparison', 'side by side', 'versus'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Custom Reports',
    route: '/portal/dashboard?suite=custom-reports',
    description: 'Build and save a custom report from any combination of charts and tables, exportable to PDF.',
    keywords: ['report', 'custom report', 'pdf', 'export', 'builder'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Biomechanics',
    route: '/portal/dashboard?suite=biomechanics',
    description: 'Biomechanics and force-plate data: impulse time, peak de-weighting, force vs. moments, PDF summary export.',
    keywords: ['biomechanics', 'force plate', 'vald', 'impulse'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Player Plans',
    route: '/portal/dashboard?suite=player-plans',
    description: 'Set and track per-player goals across mechanical, stuff, execution, and physical categories, with automated goal tracking.',
    keywords: ['player plans', 'goals', 'development plan'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Player Notes',
    route: '/portal/dashboard?suite=player-notes',
    description: 'Freeform coach notes on a player, categorized by weight room, nutrition, mental training, and questionnaires.',
    keywords: ['player notes', 'notes'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Stuff+ Calculator',
    route: '/portal/dashboard?suite=stuff-calculator',
    description: 'Standalone "what-if" calculator projecting Stuff+ from hypothetical velocity, movement, and extension inputs.',
    keywords: ['stuff+ calculator', 'what if', 'projected stuff'],
    roles: ['admin', 'coach', 'player'],
  },
  {
    title: 'Schedule Builder',
    route: '/portal/admin/schedule',
    description: 'Build and assign training programs: throwing programs, bullpen scripts, velocity programs, and drills on a calendar.',
    keywords: ['schedule', 'program builder', 'throwing program', 'bullpen script', 'drills'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Master Calendar',
    route: '/portal/admin/master-calendar',
    description: 'Read-only grid of every active player\'s assigned program items, flagging missing days for coverage checks.',
    keywords: ['master calendar', 'coverage', 'missing days'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Workouts',
    route: '/portal/admin/workouts',
    description: 'Workout library: build and save workouts composed of exercises for use in the schedule builder.',
    keywords: ['workouts', 'workout builder', 'workout library'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Exercises',
    route: '/portal/admin/exercises',
    description: 'Exercise library with instructional videos, searchable by name, category, and cues.',
    keywords: ['exercises', 'exercise library'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Testing',
    route: '/portal/admin/testing',
    description: 'Testing dashboard report builder pulling in force-plate and other testing metrics.',
    keywords: ['testing', 'force plate testing', 'testing dashboard'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Questionnaires',
    route: '/portal/admin/questionnaires',
    description: 'Build custom questionnaires and assign them to players, with response tracking.',
    keywords: ['questionnaires', 'surveys', 'assignments'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Clients',
    route: '/portal/admin/clients',
    description: 'Roster management: add, edit, and assign coaches to players.',
    keywords: ['clients', 'roster', 'players list'],
    roles: ['admin', 'coach'],
  },
  {
    title: 'Coaches',
    route: '/portal/admin/coaches',
    description: 'Coach account management.',
    keywords: ['coaches', 'coach accounts'],
    roles: ['admin'],
  },
  {
    title: 'Player Profile',
    route: '/portal/player',
    description: 'A player\'s own personal profile dashboard, including their plan/goals panel.',
    keywords: ['player profile', 'my profile'],
    roles: ['player'],
  },
  {
    title: 'Player Program',
    route: '/portal/player/program',
    description: 'A player\'s own assigned training program: throwing, bullpens, velocity work, and drills by month.',
    keywords: ['my program', 'player program', 'throwing program', 'bullpens'],
    roles: ['player'],
  },
];
