/** Single source of truth for the formal PCU player assessment's field
 * order, labels, and input types -- shared by the DB layer (validation,
 * note formatting) and the web form. Keep the mobile app's copy of this
 * list (pearl-player-development/lib/player-assessment-fields.ts) in sync
 * by hand when this changes; the two repos deploy separately. */
export type PlayerAssessmentFieldType = 'text' | 'scale' | 'number_in' | 'number_sec';

export type PlayerAssessmentField = {
  id: string;
  label: string;
  type: PlayerAssessmentFieldType;
};

export const PLAYER_ASSESSMENT_SCALE_OPTIONS = ['Normal', 'Excessive', 'Limited'] as const;

export const PLAYER_ASSESSMENT_FIELDS: PlayerAssessmentField[] = [
  { id: 'injury_history', label: 'Injury History', type: 'text' },
  { id: 'standing_posture_forward', label: 'Standing Posture Forward', type: 'text' },
  { id: 'standing_posture_behind', label: 'Standing Posture Behind', type: 'text' },
  { id: 'standing_posture_right', label: 'Standing Posture Right', type: 'text' },
  { id: 'standing_posture_left', label: 'Standing Posture Left', type: 'text' },
  { id: 'standing_right_foot_reach', label: 'Standing Right Foot Reach', type: 'text' },
  { id: 'standing_left_foot_reach', label: 'Standing Left Foot Reach', type: 'text' },
  { id: 'seated_tspine_rotation_left', label: 'Seated T-Spine Rotation Left', type: 'text' },
  { id: 'seated_tspine_rotation_right', label: 'Seated T-Spine Rotation Right', type: 'text' },
  { id: 'wide_or_narrow_bias', label: 'Wide or Narrow Bias', type: 'text' },

  { id: 'shoulder_ir_rom_right', label: 'Shoulder IR ROM Right', type: 'scale' },
  { id: 'shoulder_ir_rom_left', label: 'Shoulder IR ROM Left', type: 'scale' },
  { id: 'shoulder_er_rom_right', label: 'Shoulder ER ROM Right', type: 'scale' },
  { id: 'shoulder_er_rom_left', label: 'Shoulder ER ROM Left', type: 'scale' },
  { id: 'supine_hip_ir_right', label: 'Supine Hip IR Right', type: 'scale' },
  { id: 'supine_hip_ir_left', label: 'Supine Hip IR Left', type: 'scale' },
  { id: 'supine_hip_er_right', label: 'Supine Hip ER Right', type: 'scale' },
  { id: 'supine_hip_er_left', label: 'Supine Hip ER Left', type: 'scale' },
  { id: 'supine_slr_right', label: 'Supine SLR Right', type: 'scale' },
  { id: 'supine_slr_left', label: 'Supine SLR Left', type: 'scale' },

  { id: 'broad_jump', label: 'Broad Jump', type: 'number_in' },
  { id: 'lateral_jump_turn_right', label: '1-Leg Lateral Jump with Turn Right', type: 'number_in' },
  { id: 'lateral_jump_turn_left', label: '1-Leg Lateral Jump with Turn Left', type: 'number_in' },

  { id: 'sprint_10_yard', label: '10-yard Sprint', type: 'number_sec' },
  { id: 'sprint_40_yard', label: '40-yard Sprint', type: 'number_sec' },
  { id: 'sprint_60_yard', label: '60-yard Sprint', type: 'number_sec' },
];

export const PLAYER_ASSESSMENT_FIELD_IDS = new Set(PLAYER_ASSESSMENT_FIELDS.map((field) => field.id));
