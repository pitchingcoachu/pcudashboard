'use client';

import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

type SkeletonFrame = { frame: number; time: number; points: [number, number, number][] };
type SkeletonData = {
  landmarks: string[];
  connections: [string, string][];
  frames: SkeletonFrame[];
  hands?: Partial<Record<'left' | 'right', SkeletonFrame[]>>;
};

type Props = {
  skeleton: SkeletonData;
  time: number;
  handedness: string;
  driverRef: RefObject<HTMLVideoElement | null>;
};
type SegmentRig = { mesh: THREE.Mesh; radius: number };

const LIMB_CONNECTIONS: [string, string][] = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_heel'], ['left_heel', 'left_foot_index'], ['left_ankle', 'left_foot_index'],
  ['right_ankle', 'right_heel'], ['right_heel', 'right_foot_index'], ['right_ankle', 'right_foot_index'],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const ivory = new THREE.MeshStandardMaterial({ color: 0xeee9df, roughness: 0.56, metalness: 0.03 });
const ivoryDim = new THREE.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 0.65, metalness: 0.02 });
const jointMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.48 });

function midpoint(first: THREE.Vector3, second: THREE.Vector3) {
  return first.clone().add(second).multiplyScalar(0.5);
}

function orientBetween(mesh: THREE.Mesh, first: THREE.Vector3, second: THREE.Vector3, radius: number) {
  const direction = second.clone().sub(first);
  const length = Math.max(direction.length(), 0.001);
  mesh.position.copy(first).add(second).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.scale.set(radius, length, radius);
}

function sampledFrame(frames: SkeletonFrame[] | undefined, time: number) {
  if (!frames?.length) return null;
  if (time <= frames[0].time) return frames[0];
  if (time >= frames[frames.length - 1].time) return frames[frames.length - 1];
  let upperIndex = frames.findIndex((frame) => frame.time >= time);
  if (upperIndex <= 0) upperIndex = 1;
  const lower = frames[upperIndex - 1];
  const upper = frames[upperIndex];
  const span = Math.max(upper.time - lower.time, 0.0001);
  const progress = THREE.MathUtils.clamp((time - lower.time) / span, 0, 1);
  return {
    frame: lower.frame,
    time,
    points: lower.points.map((point, index) => {
      const target = upper.points[index] ?? point;
      return [
        THREE.MathUtils.lerp(point[0], target[0], progress),
        THREE.MathUtils.lerp(point[1], target[1], progress),
        THREE.MathUtils.lerp(point[2], target[2], progress),
      ] as [number, number, number];
    }),
  };
}

function stabilizeFrames(frames: SkeletonFrame[] | undefined, pointIndices?: Set<number>) {
  if (!frames?.length) return frames;
  return frames.map((frame, frameIndex) => {
    return {
      ...frame,
      points: frame.points.map((point, pointIndex) => {
        if (pointIndices && !pointIndices.has(pointIndex)) return point;
        return [0, 1, 2].map((axis) => {
          let weightedTotal = 0;
          let totalWeight = 0;
          for (let offset = -2; offset <= 2; offset += 1) {
            const sample = frames[frameIndex + offset]?.points[pointIndex]?.[axis];
            if (sample === undefined) continue;
            const weight = 3 - Math.abs(offset);
            weightedTotal += sample * weight;
            totalWeight += weight;
          }
          return totalWeight ? weightedTotal / totalWeight : point[axis];
        }) as [number, number, number];
      }),
    };
  });
}

function makeRibGeometry(side: -1 | 1) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.03, -0.7),
    new THREE.Vector3(side * 0.58, 0.01, -0.55),
    new THREE.Vector3(side, -0.08, -0.02),
    new THREE.Vector3(side * 0.72, -0.14, 0.48),
    new THREE.Vector3(side * 0.08, -0.1, 0.66),
  ]);
  return new THREE.TubeGeometry(curve, 24, 0.035, 7, false);
}

export default function MocapAnatomicalViewer({ skeleton, time, handedness, driverRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(time);
  useEffect(() => { timeRef.current = time; }, [time]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !skeleton.frames.length) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050506);
    scene.fog = new THREE.Fog(0x050506, 5.4, 9.5);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 30);
    camera.position.set(2.15, 1.45, 3.05);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.95, 0);
    controls.minDistance = 1.7;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.zoomToCursor = true;

    scene.add(new THREE.HemisphereLight(0xf9f1df, 0x171014, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
    keyLight.position.set(3.5, 5, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xc8102e, 3.2);
    rimLight.position.set(-4, 2.5, -3);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({ color: 0x111012, roughness: 0.9, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    scene.add(floor);
    const grid = new THREE.GridHelper(9, 18, 0x7a1024, 0x292326);
    grid.position.y = 0.002;
    scene.add(grid);

    const anatomy = new THREE.Group();
    scene.add(anatomy);
    const shaftGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    const jointGeometry = new THREE.SphereGeometry(1, 16, 12);
    const segmentRigs = new Map<string, SegmentRig>();
    const jointMeshes = new Map<string, THREE.Mesh>();
    LIMB_CONNECTIONS.forEach(([from, to]) => {
      const lowerLegOrArm = /elbow|ankle|heel|foot/.test(`${from}-${to}`);
      const radius = /foot/.test(`${from}-${to}`) ? 0.018 : lowerLegOrArm ? 0.026 : 0.035;
      const mesh = new THREE.Mesh(shaftGeometry, ivory);
      anatomy.add(mesh);
      segmentRigs.set(`${from}-${to}`, { mesh, radius });
    });

    skeleton.landmarks.filter((key) => /shoulder|elbow|wrist|hip|knee|ankle/.test(key)).forEach((key) => {
      const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
      mesh.scale.setScalar(/hip|shoulder/.test(key) ? 0.052 : /knee|elbow/.test(key) ? 0.045 : 0.032);
      anatomy.add(mesh);
      jointMeshes.set(key, mesh);
    });

    const chest = new THREE.Group();
    anatomy.add(chest);
    const ribs: THREE.Mesh[] = [];
    for (let index = 0; index < 7; index += 1) {
      ([-1, 1] as const).forEach((side) => {
        const rib = new THREE.Mesh(makeRibGeometry(side), index < 2 ? ivoryDim : ivory);
        rib.position.y = 0.5 - index * 0.145;
        const taper = 0.78 + Math.sin(((index + 1) / 8) * Math.PI) * 0.25;
        rib.scale.set(taper, 1, 0.88 + index * 0.015);
        chest.add(rib);
        ribs.push(rib);
      });
    }
    const sternum = new THREE.Mesh(shaftGeometry, ivory);
    sternum.position.set(0, 0.04, 0.63);
    sternum.scale.set(0.055, 0.72, 0.045);
    chest.add(sternum);
    const spine = new THREE.Mesh(shaftGeometry, ivoryDim);
    spine.position.set(0, -0.02, -0.67);
    spine.scale.set(0.055, 1.15, 0.055);
    chest.add(spine);
    for (let index = 0; index < 8; index += 1) {
      const vertebra = new THREE.Mesh(jointGeometry, ivory);
      vertebra.position.set(0, 0.48 - index * 0.14, -0.68);
      vertebra.scale.set(0.085, 0.045, 0.075);
      chest.add(vertebra);
    }

    const pelvis = new THREE.Group();
    anatomy.add(pelvis);
    ([-1, 1] as const).forEach((side) => {
      const ilium = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14, 0, Math.PI * 2, 0.15, Math.PI * 0.72), ivory);
      ilium.position.set(side * 0.52, 0.08, 0);
      ilium.scale.set(0.5, 0.42, 0.28);
      ilium.rotation.z = side * -0.28;
      pelvis.add(ilium);
      const pubis = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.045, 8, 20, Math.PI * 1.55), ivoryDim);
      pubis.position.set(side * 0.2, -0.24, 0.08);
      pubis.rotation.z = side > 0 ? -0.12 : Math.PI + 0.12;
      pelvis.add(pubis);
    });
    const sacrum = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 10), ivoryDim);
    sacrum.position.set(0, -0.08, -0.12);
    pelvis.add(sacrum);

    const skull = new THREE.Group();
    anatomy.add(skull);
    const fallbackSkull = new THREE.Group();
    skull.add(fallbackSkull);
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 22), ivory);
    cranium.scale.set(0.7, 0.82, 0.72);
    cranium.position.set(0, 0.25, -0.05);
    fallbackSkull.add(cranium);
    const face = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), ivoryDim);
    face.scale.set(0.52, 0.58, 0.44);
    face.position.set(0, -0.16, 0.34);
    fallbackSkull.add(face);
    const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.09, 8, 24, Math.PI), ivory);
    jaw.scale.set(1, 0.9, 0.8);
    jaw.rotation.z = Math.PI;
    jaw.position.set(0, -0.48, 0.32);
    fallbackSkull.add(jaw);
    const maxilla = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.16), ivory);
    maxilla.position.set(0, -0.2, 0.69);
    fallbackSkull.add(maxilla);
    const socketMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2929 });
    ([-1, 1] as const).forEach((side) => {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), socketMaterial);
      socket.scale.set(0.145, 0.12, 0.045);
      socket.position.set(side * 0.2, 0.02, 0.72);
      fallbackSkull.add(socket);
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 8), ivoryDim);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.13, 0.79);
    fallbackSkull.add(nose);

    let loadedSkull: THREE.Object3D | null = null;
    const skullLoader = new GLTFLoader();
    skullLoader.setMeshoptDecoder(MeshoptDecoder);
    skullLoader.load('/mocap/anatomy/human-skull.glb', (gltf) => {
      loadedSkull = gltf.scene;
      loadedSkull.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = ivory;
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
      loadedSkull.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(loadedSkull);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const normalization = 1.55 / Math.max(size.y, 0.001);
      loadedSkull.scale.setScalar(normalization);
      loadedSkull.position.set(
        -center.x * normalization,
        -center.y * normalization + 0.08,
        -center.z * normalization
      );
      loadedSkull.rotation.y = Math.PI;
      skull.add(loadedSkull);
      fallbackSkull.visible = false;
    });

    const neck = new THREE.Mesh(shaftGeometry, ivoryDim);
    anatomy.add(neck);
    const clavicles = [new THREE.Mesh(shaftGeometry, ivory), new THREE.Mesh(shaftGeometry, ivory)];
    clavicles.forEach((mesh) => anatomy.add(mesh));

    const handRigs = new Map<string, SegmentRig>();
    (['left', 'right'] as const).forEach((side) => {
      HAND_CONNECTIONS.forEach(([from, to]) => {
        const mesh = new THREE.Mesh(shaftGeometry, ivory);
        anatomy.add(mesh);
        handRigs.set(`${side}-${from}-${to}`, { mesh, radius: 0.007 });
      });
    });

    const indexByKey = new Map(skeleton.landmarks.map((key, index) => [key, index]));
    const throwingSide = handedness === 'L' ? 'left' : 'right';
    const stabilizedBodyIndices = new Set([
      indexByKey.get(`${throwingSide}_shoulder`),
      indexByKey.get(`${throwingSide}_elbow`),
      indexByKey.get(`${throwingSide}_wrist`),
    ].filter((index): index is number => typeof index === 'number'));
    const stabilizedBodyFrames = stabilizeFrames(skeleton.frames, stabilizedBodyIndices) ?? skeleton.frames;
    const stabilizedHands = {
      left: stabilizeFrames(skeleton.hands?.left),
      right: stabilizeFrames(skeleton.hands?.right),
    };
    const anchorFrame = skeleton.frames[0];
    const anchorLeftHip = anchorFrame.points[indexByKey.get('left_hip') ?? 0];
    const anchorRightHip = anchorFrame.points[indexByKey.get('right_hip') ?? 0];
    const anchor: [number, number, number] = [
      (anchorLeftHip[0] + anchorRightHip[0]) / 2,
      0,
      (anchorLeftHip[2] + anchorRightHip[2]) / 2,
    ];
    const footIndices = skeleton.landmarks
      .map((key, index) => (/ankle|heel|foot_index/.test(key) ? index : -1))
      .filter((index) => index >= 0);
    const floorY = Math.min(...skeleton.frames.flatMap((frame) => footIndices.map((index) => frame.points[index][1])));
    let lastTime = Number.NaN;
    const worldPoints = new Map<string, THREE.Vector3>();
    const vectorFromRaw = (point: [number, number, number]) => new THREE.Vector3(
      (point[0] - anchor[0]) / 1000,
      (point[1] - floorY) / 1000,
      (point[2] - anchor[2]) / 1000
    );

    const updatePose = () => {
      const driver = driverRef.current;
      const poseTime = driver && !driver.paused ? driver.currentTime : timeRef.current;
      const frame = sampledFrame(stabilizedBodyFrames, poseTime);
      if (!frame || frame.time === lastTime) return;
      lastTime = frame.time;
      skeleton.landmarks.forEach((key, index) => worldPoints.set(key, vectorFromRaw(frame.points[index])));

      segmentRigs.forEach((rig, key) => {
        const [from, to] = key.split('-');
        const first = worldPoints.get(from);
        const second = worldPoints.get(to);
        if (first && second) orientBetween(rig.mesh, first, second, rig.radius);
      });
      jointMeshes.forEach((mesh, key) => { const point = worldPoints.get(key); if (point) mesh.position.copy(point); });

      const leftShoulder = worldPoints.get('left_shoulder')!;
      const rightShoulder = worldPoints.get('right_shoulder')!;
      const leftHip = worldPoints.get('left_hip')!;
      const rightHip = worldPoints.get('right_hip')!;
      const shoulderMid = midpoint(leftShoulder, rightShoulder);
      const hipMid = midpoint(leftHip, rightHip);
      const cameraShift = new THREE.Vector3(
        hipMid.x - controls.target.x,
        0,
        hipMid.z - controls.target.z
      );
      camera.position.add(cameraShift);
      controls.target.x = hipMid.x;
      controls.target.z = hipMid.z;
      const sideAxis = rightShoulder.clone().sub(leftShoulder).normalize();
      const verticalAxis = shoulderMid.clone().sub(hipMid).normalize();
      const depthAxis = new THREE.Vector3().crossVectors(sideAxis, verticalAxis).normalize();
      const torsoBasis = new THREE.Matrix4().makeBasis(sideAxis, verticalAxis, depthAxis);
      chest.position.copy(hipMid).lerp(shoulderMid, 0.55);
      chest.quaternion.setFromRotationMatrix(torsoBasis);
      chest.scale.set(leftShoulder.distanceTo(rightShoulder) * 0.38, shoulderMid.distanceTo(hipMid) * 0.7, leftShoulder.distanceTo(rightShoulder) * 0.32);

      const hipSide = rightHip.clone().sub(leftHip).normalize();
      const pelvisDepth = new THREE.Vector3().crossVectors(hipSide, verticalAxis).normalize();
      pelvis.position.copy(hipMid);
      pelvis.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(hipSide, verticalAxis, pelvisDepth));
      pelvis.scale.set(leftHip.distanceTo(rightHip) * 0.82, leftHip.distanceTo(rightHip) * 0.76, leftHip.distanceTo(rightHip) * 0.76);

      const leftEar = worldPoints.get('left_ear')!;
      const rightEar = worldPoints.get('right_ear')!;
      const nosePoint = worldPoints.get('nose')!;
      const earMid = midpoint(leftEar, rightEar);
      const headSide = rightEar.clone().sub(leftEar).normalize();
      const headForward = nosePoint.clone().sub(earMid).normalize();
      const headUp = new THREE.Vector3().crossVectors(headForward, headSide).normalize();
      skull.position.copy(earMid).addScaledVector(headUp, 0.045);
      skull.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(headSide, headUp, headForward));
      skull.scale.setScalar(Math.max(leftEar.distanceTo(rightEar) * 0.78, 0.12));
      orientBetween(neck, shoulderMid, earMid, 0.042);
      orientBetween(clavicles[0], shoulderMid, leftShoulder, 0.024);
      orientBetween(clavicles[1], shoulderMid, rightShoulder, 0.024);

      (['left', 'right'] as const).forEach((side) => {
        const handFrame = sampledFrame(stabilizedHands[side], poseTime);
        if (!handFrame) return;
        const handPoints = handFrame.points.map((point) => vectorFromRaw(point));
        HAND_CONNECTIONS.forEach(([from, to]) => {
          const rig = handRigs.get(`${side}-${from}-${to}`);
          if (rig) orientBetween(rig.mesh, handPoints[from], handPoints[to], rig.radius);
        });
      });
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    let animationFrame = 0;
    const render = () => {
      updatePose();
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();

    const frontView = () => { camera.position.set(0, 1.4, 3.4); controls.target.set(0, 0.95, 0); controls.update(); };
    const sideView = () => { camera.position.set(3.4, 1.4, 0); controls.target.set(0, 0.95, 0); controls.update(); };
    const resetView = () => { camera.position.set(2.15, 1.45, 3.05); controls.target.set(0, 0.95, 0); controls.update(); };
    host.addEventListener('mocap-front-view', frontView);
    host.addEventListener('mocap-side-view', sideView);
    host.addEventListener('mocap-reset-view', resetView);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      if (loadedSkull) {
        loadedSkull.traverse((child) => {
          if (child instanceof THREE.Mesh) child.geometry.dispose();
        });
      }
      renderer.dispose();
      host.removeEventListener('mocap-front-view', frontView);
      host.removeEventListener('mocap-side-view', sideView);
      host.removeEventListener('mocap-reset-view', resetView);
      host.replaceChildren();
    };
  }, [driverRef, handedness, skeleton]);

  const dispatch = (name: string) => hostRef.current?.dispatchEvent(new Event(name));
  return (
    <div className="pcu-mocap-anatomical-stage">
      <div ref={hostRef} className="pcu-mocap-three-canvas" />
      <div className="pcu-mocap-skeleton-tools">
        <button type="button" onClick={() => dispatch('mocap-front-view')}>Front</button>
        <button type="button" onClick={() => dispatch('mocap-side-view')}>Side</button>
        <button type="button" onClick={() => dispatch('mocap-reset-view')}>Reset</button>
      </div>
      <span className="pcu-mocap-skeleton-hint">Drag to orbit · Scroll to zoom · Right-drag to pan</span>
    </div>
  );
}
