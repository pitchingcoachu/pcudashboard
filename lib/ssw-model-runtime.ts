import artifactJson from '../data/models/ssw-ridge-candidate-v1.json';

type Vector3 = { x: number; y: number; z: number };
type TreeNode = { value: number; feature: number; threshold: number; left: number; right: number; missing_left: boolean; leaf: boolean };
type TreeModel = { baseline: number; trees: TreeNode[][] };
type Artifact = { nonlinear_model: { context_hb: TreeModel; context_ivb: TreeModel; hb: TreeModel; ivb: TreeModel }; validation: { nonlinear_uncertainty: { validation_vector_error_quantiles_inches: Record<string, number> } } };

const artifact = artifactJson as unknown as Artifact;

export type SswModelInput = {
  velocityMph: number;
  spinRateRpm: number;
  spinEfficiencyPercent: number;
  extensionFeet: number;
  releaseHeightFeet: number;
  releaseSideFeet: number;
  sceneSpinAxis: Vector3;
  seamOrientation: Vector3;
};

export type SswModelPrediction = {
  hb: number; ivb: number;
  seamHb: number; seamIvb: number;
  contextHb: number; contextIvb: number;
  errorRadius80: number; modelVersion: 'ssw-hgb-v1';
};

const radians = (degrees: number) => degrees * Math.PI / 180;
const multiply = (a: number[][], b: number[][]) => a.map((row) => b[0].map((_, column) => row.reduce((sum, value, index) => sum + value * b[index][column], 0)));

function rotationMatrix({ x, y, z }: Vector3): number[][] {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(radians(x)), Math.sin(radians(x)), Math.cos(radians(y)), Math.sin(radians(y)), Math.cos(radians(z)), Math.sin(radians(z))];
  const rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return multiply(multiply(rz, rx), ry);
}

function treePrediction(model: TreeModel, features: number[]): number {
  let prediction = model.baseline;
  for (const tree of model.trees) {
    let index = 0;
    while (!tree[index].leaf) {
      const node = tree[index];
      const value = features[node.feature];
      index = Number.isNaN(value) ? (node.missing_left ? node.left : node.right) : (value <= node.threshold ? node.left : node.right);
    }
    prediction += tree[index].value;
  }
  return prediction;
}

export function predictSswMovement(input: SswModelInput): SswModelPrediction {
  const efficiency = Math.max(0, Math.min(1, input.spinEfficiencyPercent / 100));
  const activeSpin = input.spinRateRpm * efficiency;
  // Spin Designer uses scene axes. Invert the renderer's TrackMan -> scene ZXY transform.
  const axis = [input.sceneSpinAxis.y, input.sceneSpinAxis.z, input.sceneSpinAxis.x];
  const rotation = rotationMatrix(input.seamOrientation);
  const spinInBall = [0, 1, 2].map((column) => rotation.reduce((sum, row, index) => sum + row[column] * axis[index], 0));
  const features = [
    input.velocityMph, input.spinRateRpm, activeSpin, efficiency, input.extensionFeet,
    input.releaseHeightFeet, input.releaseSideFeet, ...axis, ...rotation.flat(), ...spinInBall,
    ...spinInBall.map((value) => value * input.velocityMph / 90),
    ...spinInBall.map((value) => value * activeSpin / 2200),
  ];
  const contextHb = treePrediction(artifact.nonlinear_model.context_hb, features.slice(0, 10));
  const contextIvb = treePrediction(artifact.nonlinear_model.context_ivb, features.slice(0, 10));
  const hb = treePrediction(artifact.nonlinear_model.hb, features);
  const ivb = treePrediction(artifact.nonlinear_model.ivb, features);
  return {
    hb, ivb, contextHb, contextIvb,
    seamHb: hb - contextHb,
    seamIvb: ivb - contextIvb,
    errorRadius80: artifact.validation.nonlinear_uncertainty.validation_vector_error_quantiles_inches['80'],
    modelVersion: 'ssw-hgb-v1',
  };
}
