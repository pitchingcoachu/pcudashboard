import * as THREE from 'three';

export type SpinRenderQuaternion = { w: number; x: number; y: number; z: number };
export type SpinRenderCamera = { yaw: number; pitch: number; zoom: number };
export type SpinRenderOptions = {
  axis?: { visible: boolean; x: number; y: number; z: number };
};

function seamPoint(parameter: number, radius = 1): THREE.Vector3 {
  // A spherical baseball-cover seam: one closed curve with two deep lobes.
  // The 0..4PI domain is important; using a single revolution makes the seam
  // collapse visually into an equatorial belt instead of the familiar pair
  // of opposing baseball panels.
  const seamShape = 0.4;
  const polar = (Math.PI / 2) - (((Math.PI / 2) - seamShape) * Math.cos(parameter));
  const azimuth = (parameter / 2) + (seamShape * Math.sin(parameter * 2));
  return new THREE.Vector3(
    Math.sin(polar) * Math.cos(azimuth),
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
  ).multiplyScalar(radius);
}

function makeLeatherTexture(): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = 1024;
  colorCanvas.height = 512;
  const colorContext = colorCanvas.getContext('2d');
  if (!colorContext) throw new Error('Unable to create baseball leather texture.');
  colorContext.fillStyle = '#eee8d7';
  colorContext.fillRect(0, 0, colorCanvas.width, colorCanvas.height);

  let seed = 4711;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < 5600; index += 1) {
    const alpha = 0.018 + (random() * 0.028);
    colorContext.fillStyle = `rgba(86,65,42,${alpha})`;
    colorContext.beginPath();
    colorContext.arc(random() * 1024, random() * 512, 0.35 + (random() * 0.65), 0, Math.PI * 2);
    colorContext.fill();
  }
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 128;
  const bumpContext = bumpCanvas.getContext('2d');
  if (!bumpContext) throw new Error('Unable to create baseball grain texture.');
  const image = bumpContext.createImageData(256, 128);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = 118 + Math.floor(random() * 30);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  bumpContext.putImageData(image, 0, 0);

  const color = new THREE.CanvasTexture(colorCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = THREE.RepeatWrapping;
  color.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(4, 3);
  return { color, bump };
}

function setCylinderTransform(matrix: THREE.Matrix4, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  matrix.compose(midpoint, rotation, new THREE.Vector3(radius, length, radius));
}

function setSphereTransform(matrix: THREE.Matrix4, position: THREE.Vector3, radius: number) {
  matrix.compose(
    position,
    new THREE.Quaternion(),
    new THREE.Vector3(radius, radius, radius),
  );
}

function makeBaseball(): THREE.Group {
  const group = new THREE.Group();
  const leather = makeLeatherTexture();
  const sphereMaterial = new THREE.MeshPhysicalMaterial({
    map: leather.color,
    bumpMap: leather.bump,
    bumpScale: 0.018,
    color: 0xfffcf0,
    roughness: 0.79,
    metalness: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.82,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 52), sphereMaterial);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  group.add(sphere);

  const seamPoints = Array.from(
    { length: 360 },
    (_, index) => seamPoint((index / 360) * Math.PI * 4, 1.006),
  );
  const seamCurve = new THREE.CatmullRomCurve3(seamPoints, true, 'centripetal');
  const seamEdgeOffset = 0.03;
  const stitchCount = 108;
  const stitchGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
  const stitchMaterial = new THREE.MeshStandardMaterial({ color: 0xb51d32, roughness: 0.64 });
  const stitches = new THREE.InstancedMesh(stitchGeometry, stitchMaterial, stitchCount * 4);
  const punctures = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 7, 5),
    new THREE.MeshStandardMaterial({ color: 0x711326, roughness: 1 }),
    stitchCount * 2,
  );
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < stitchCount; index += 1) {
    const amount = (index + 0.5) / stitchCount;
    const center = seamCurve.getPointAt(amount).normalize();
    const tangent = seamCurve.getTangentAt(amount).normalize();
    const across = new THREE.Vector3().crossVectors(center, tangent).normalize();
    // The opposing rows lean toward one another like a sewn baseball cover.
    // Each thread rises slightly between its punctures, so lighting produces
    // a curved cord and shadow instead of a flat comb tooth.
    const innerLeft = center.clone()
      .addScaledVector(across, seamEdgeOffset)
      .addScaledVector(tangent, 0.015)
      .normalize()
      .multiplyScalar(1.035);
    const outerLeft = center.clone()
      .addScaledVector(across, 0.082)
      .addScaledVector(tangent, -0.022)
      .normalize()
      .multiplyScalar(1.026);
    const middleLeft = innerLeft.clone().add(outerLeft).normalize().multiplyScalar(1.048);
    const innerRight = center.clone()
      .addScaledVector(across, -seamEdgeOffset)
      .addScaledVector(tangent, 0.015)
      .normalize()
      .multiplyScalar(1.035);
    const outerRight = center.clone()
      .addScaledVector(across, -0.082)
      .addScaledVector(tangent, -0.022)
      .normalize()
      .multiplyScalar(1.026);
    const middleRight = innerRight.clone().add(outerRight).normalize().multiplyScalar(1.048);

    setCylinderTransform(matrix, outerLeft, middleLeft, 0.0095);
    stitches.setMatrixAt(index * 4, matrix);
    setCylinderTransform(matrix, middleLeft, innerLeft, 0.0095);
    stitches.setMatrixAt((index * 4) + 1, matrix);
    setCylinderTransform(matrix, outerRight, middleRight, 0.0095);
    stitches.setMatrixAt((index * 4) + 2, matrix);
    setCylinderTransform(matrix, middleRight, innerRight, 0.0095);
    stitches.setMatrixAt((index * 4) + 3, matrix);

    setSphereTransform(matrix, outerLeft.clone().normalize().multiplyScalar(1.012), 0.014);
    punctures.setMatrixAt(index * 2, matrix);
    setSphereTransform(matrix, outerRight.clone().normalize().multiplyScalar(1.012), 0.014);
    punctures.setMatrixAt((index * 2) + 1, matrix);
  }
  stitches.instanceMatrix.needsUpdate = true;
  stitches.castShadow = true;
  punctures.instanceMatrix.needsUpdate = true;
  punctures.receiveShadow = true;
  group.add(punctures);
  group.add(stitches);
  return group;
}

function makeHomePlate(): THREE.Group {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.72, 0.42);
  shape.lineTo(0.72, 0.42);
  shape.lineTo(0.72, -0.16);
  shape.lineTo(0, -0.78);
  shape.lineTo(-0.72, -0.16);
  shape.closePath();
  const plate = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: 0xf4f3e9, roughness: 0.88 }),
  );
  plate.receiveShadow = true;
  group.add(plate);
  const edgePoints = shape.getPoints().map((point) => new THREE.Vector3(point.x, point.y, 0.012));
  edgePoints.push(edgePoints[0].clone());
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(edgePoints),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  ));
  group.position.set(0, -3.1, -1.03);
  group.scale.setScalar(0.72);
  return group;
}

type AxisRod = {
  group: THREE.Group;
  positiveMaterial: THREE.MeshStandardMaterial;
  negativeMaterial: THREE.MeshStandardMaterial;
};

function makeAxisRod(): AxisRod {
  const group = new THREE.Group();
  const shaftMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8102e,
    emissive: 0x3a050e,
    emissiveIntensity: 0.7,
    roughness: 0.48,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 3.35, 10), shaftMaterial);
  shaft.castShadow = true;
  group.add(shaft);
  const positive = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 12), shaftMaterial);
  positive.position.y = 1.77;
  positive.castShadow = true;
  group.add(positive);
  const negativeMaterial = new THREE.MeshStandardMaterial({ color: 0x6e1726, roughness: 0.72 });
  const negative = new THREE.Mesh(
    new THREE.SphereGeometry(0.052, 12, 8),
    negativeMaterial,
  );
  negative.position.y = -1.69;
  group.add(negative);
  group.visible = false;
  return { group, positiveMaterial: shaftMaterial, negativeMaterial };
}

export class SpinBaseballRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(29, 1, 0.1, 40);
  private readonly baseball = makeBaseball();
  private readonly axis = makeAxisRod();
  private axisAccent = '';
  private width = 0;
  private height = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.baseball.position.z = 0.02;
    this.scene.add(this.baseball);
    this.axis.group.position.z = 0.02;
    this.scene.add(this.axis.group);
    this.scene.add(new THREE.HemisphereLight(0xfff8e6, 0x202325, 2.35));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(-3.8, 4.2, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 15;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb8d4ff, 1.25);
    rim.position.set(4, -4, 2.5);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 13),
      new THREE.MeshStandardMaterial({ color: 0x25282a, roughness: 1, transparent: true, opacity: 0.2 }),
    );
    ground.position.set(0, 0, -1.055);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(makeHomePlate());
  }

  render(
    target: HTMLCanvasElement,
    orientation: SpinRenderQuaternion,
    view: SpinRenderCamera,
    options: SpinRenderOptions = {},
  ) {
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.45);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
    }

    this.baseball.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w).normalize();
    const axis = options.axis;
    this.axis.group.visible = Boolean(axis?.visible);
    if (axis?.visible) {
      this.syncAxisAccent();
      const direction = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
      this.axis.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    }
    const distance = 5.15 / view.zoom;
    const cosPitch = Math.cos(view.pitch);
    this.camera.position.set(
      Math.cos(view.yaw) * cosPitch * distance,
      Math.sin(view.yaw) * cosPitch * distance,
      0.48 + (Math.sin(view.pitch) * distance),
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, -0.04);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    const context = target.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(this.renderer.domElement, 0, 0, width, height);
  }

  private syncAxisAccent() {
    const raw = getComputedStyle(document.body).getPropertyValue('--portal-accent-rgb').trim();
    if (!raw || raw === this.axisAccent) return;
    this.axisAccent = raw;
    const accent = new THREE.Color(`rgb(${raw})`);
    this.axis.positiveMaterial.color.copy(accent);
    this.axis.positiveMaterial.emissive.copy(accent).multiplyScalar(0.24);
    this.axis.negativeMaterial.color.copy(accent).multiplyScalar(0.52);
  }

  dispose() {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
          material.map?.dispose();
          material.bumpMap?.dispose();
        }
        material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
