type PitchValueInput = {
  pitch_call?: string | null;
  play_result?: string | null;
  korbb?: string | null;
  balls_num?: number | null;
  strikes_num?: number | null;
  outs_num?: number | null;
  outs_on_play_num?: number | null;
  pitch_value?: number | null;
};

function normToken(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function countAdjust(balls: unknown, strikes: unknown): number {
  const b = Math.min(3, Math.max(0, Number.isFinite(Number(balls)) ? Number(balls) : 0));
  const s = Math.min(2, Math.max(0, Number.isFinite(Number(strikes)) ? Number(strikes) : 0));
  const raw = (b - s) * 0.02;
  return Math.max(-0.08, Math.min(0.08, raw));
}

function toPitchCall(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const token = normToken(raw);
  if (token === 'called_strike') return 'StrikeCalled';
  if (token === 'ball') return 'BallCalled';
  if (token === 'hit_by_pitch') return 'HitByPitch';
  if (token === 'blocked_ball') return 'BallinDirt';
  if (token === 'foul') return 'FoulBall';
  if (token === 'in_play' || token.startsWith('hit_into_play')) return 'InPlay';
  if (token === 'swinging_strike' || token === 'swinging_strike_blocked' || token === 'swinging_strike_pitchout') return 'StrikeSwinging';
  return raw;
}

function canonicalPlayResult(value: unknown): string {
  const token = normToken(value);
  if (!token) return '';
  if (token === 'single') return 'Single';
  if (token === 'double') return 'Double';
  if (token === 'triple') return 'Triple';
  if (token === 'home_run' || token === 'homerun') return 'HomeRun';
  if (token === 'walk' || token === 'intentional_walk') return 'Walk';
  if (token === 'hit_by_pitch') return 'HitByPitch';
  if (token === 'field_error' || token === 'error') return 'Error';
  if (token === 'field_out' || token === 'force_out' || token === 'double_play' || token === 'triple_play' || token === 'fielders_choice' || token === 'sac_fly' || token === 'sac_bunt') return 'Out';
  if (token === 'strikeout' || token === 'strikeout_double_play' || token === 'strikeoutdoubleplay') return 'Strikeout';
  return String(value ?? '');
}

export function calcPitchValue(input: PitchValueInput): number {
  if (typeof input.pitch_value === 'number' && Number.isFinite(input.pitch_value)) return input.pitch_value;

  const pitchCall = toPitchCall(input.pitch_call);
  const playResult = canonicalPlayResult(input.play_result);
  const korbb = String(input.korbb ?? '');
  const adjust = countAdjust(input.balls_num, input.strikes_num);

  if (korbb === 'Strikeout' || playResult === 'Strikeout') return -0.18 + (0.35 * adjust);
  if (korbb === 'Walk' || playResult === 'Walk') return 0.36 + (0.35 * adjust);
  if (pitchCall === 'HitByPitch' || playResult === 'HitByPitch') return 0.34 + (0.35 * adjust);

  if (pitchCall === 'InPlay' || playResult) {
    if (playResult === 'Single') return 0.48;
    if (playResult === 'Double') return 0.78;
    if (playResult === 'Triple') return 1.09;
    if (playResult === 'HomeRun') return 1.4;
    if (playResult === 'Error') return 0.33;
    return -0.1;
  }

  if (pitchCall === 'BallCalled' || pitchCall === 'BallinDirt' || pitchCall === 'BallIntentional') return 0.02 + (0.35 * adjust);
  if (pitchCall === 'StrikeCalled') return -0.03 + (0.35 * adjust);
  if (pitchCall === 'StrikeSwinging') return -0.05 + (0.35 * adjust);
  if (pitchCall === 'FoulBall' || pitchCall === 'FoulBallFieldable' || pitchCall === 'FoulBallNotFieldable') {
    const strikes = Math.min(2, Math.max(0, Number.isFinite(Number(input.strikes_num)) ? Number(input.strikes_num) : 0));
    return (strikes >= 2 ? -0.005 : -0.02) + (0.3 * adjust);
  }

  return 0;
}
