import * as THREE from 'three';
import { CAR } from '@/config';
import { makeGlowTexture } from '@/world/Sky';

/**
 * Процедурная Toyota Mark II (JZX100-вайб): белый седан, тёмные стёкла, широкие колёса,
 * неоновая подсветка днища, праворульная — водительская дверь справа.
 * Локальные оси: нос = -Z, правая сторона = +X, вверх = +Y. Пол на y = 0.
 */
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  wheelPivots: THREE.Group[];
  wheelMeshes: THREE.Mesh[];
  door: THREE.Group;
  headlights: THREE.SpotLight[];
  headlightMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  neonLight: THREE.PointLight;
  neonGlowMat: THREE.MeshBasicMaterial;
  neonStripMat: THREE.MeshStandardMaterial;
  bodyMat: THREE.MeshPhysicalMaterial;
  spoiler: THREE.Group;
  seatAnchor: THREE.Object3D;
  exhaustFlame: THREE.Mesh;
  exhaustFlameMat: THREE.MeshBasicMaterial;
}

export function buildCarModel(envMap: THREE.Texture | null): CarModel {
  const root = new THREE.Group();
  root.name = 'car';
  const body = new THREE.Group();
  body.name = 'car-body';
  root.add(body);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xf3f3f5,
    metalness: 0.2,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMap,
    envMapIntensity: 1.3,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1018,
    metalness: 0.9,
    roughness: 0.08,
    envMap,
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.92,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.6, metalness: 0.3 });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd7dbe2,
    metalness: 0.95,
    roughness: 0.2,
    envMap,
    envMapIntensity: 1.2,
  });

  // ── Нижняя часть кузова (профиль в плоскости z/y, вытянут по x) ──
  const lower = new THREE.Shape();
  const lp: Array<[number, number]> = [
    [-2.36, 0.36],
    [-2.42, 0.54],
    [-2.38, 0.7],
    [-2.16, 0.79],
    [-0.8, 0.9],
    [1.4, 0.95],
    [2.26, 0.91],
    [2.38, 0.7],
    [2.4, 0.5],
    [2.32, 0.36],
  ];
  lower.moveTo(lp[0][0], lp[0][1]);
  for (let i = 1; i < lp.length; i++) lower.lineTo(lp[i][0], lp[i][1]);
  lower.closePath();
  const lowerGeo = extrudeProfile(lower, CAR.width, 0.07, 0.07, 3);
  const lowerMesh = new THREE.Mesh(lowerGeo, bodyMat);
  body.add(lowerMesh);

  // ── Кабина (стекло) ──
  const cabin = new THREE.Shape();
  const cp: Array<[number, number]> = [
    [-0.82, 0.9],
    [-0.14, 1.34],
    [0.96, 1.36],
    [1.74, 0.94],
  ];
  cabin.moveTo(cp[0][0], cp[0][1]);
  for (let i = 1; i < cp.length; i++) cabin.lineTo(cp[i][0], cp[i][1]);
  cabin.closePath();
  const cabinGeo = extrudeProfile(cabin, CAR.width - 0.22, 0.02, 0.02, 1);
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  body.add(cabinMesh);

  // Крыша (белая панель поверх стекла)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.3, 0.05, 1.12), bodyMat);
  roof.position.set(0, 1.375, 0.41);
  body.add(roof);

  // Стойки
  const pillar = (from: [number, number], to: [number, number], x: number) => {
    const dz = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dz, dy);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.12), darkMat);
    m.position.set(x, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
    m.rotation.x = Math.atan2(dz, dy);
    body.add(m);
  };
  for (const x of [-0.75, 0.75]) {
    pillar([-0.82, 0.9], [-0.14, 1.34], x);
    pillar([1.74, 0.94], [0.96, 1.36], x);
    pillar([0.42, 0.92], [0.42, 1.36], x + (x > 0 ? 0.02 : -0.02));
  }

  // Салон — тёмный пол/торпедо (чтобы сквозь стёкла не белел кузов), сиденья, руль
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 1 });
  const floorPlate = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.36, 0.05, 2.5), interiorMat);
  floorPlate.position.set(0, 0.955, 0.42);
  body.add(floorPlate);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.4, 0.18, 0.5), interiorMat);
  dash.position.set(0, 1.04, -0.6);
  body.add(dash);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.9 });
  for (const x of [-0.42, 0.42]) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.12), seatMat);
    back.position.set(x, 1.12, 0.5);
    back.rotation.x = 0.15;
    body.add(back);
  }
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 24), darkMat);
  wheel.position.set(0.42, 1.08, -0.34);
  wheel.rotation.x = -Math.PI / 3;
  body.add(wheel);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0.42, 0.9, 0.22);
  body.add(seatAnchor);

  // ── Фары ──
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe9f3ff,
    emissiveIntensity: 3.2,
    roughness: 0.2,
  });
  const headlights: THREE.SpotLight[] = [];
  for (const x of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.15, 0.08), headlightMat);
    hl.position.set(x, 0.7, -2.42);
    body.add(hl);
    const spot = new THREE.SpotLight(0xf2f7ff, 150, 75, 0.5, 0.5, 2);
    spot.position.set(x, 0.72, -2.3);
    const target = new THREE.Object3D();
    target.position.set(x * 1.4, -0.6, -28);
    root.add(target);
    spot.target = target;
    root.add(spot);
    headlights.push(spot);
  }
  // Решётка и бампер
  const grill = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.06), darkMat);
  grill.position.set(0, 0.66, -2.42);
  body.add(grill);
  const bumperLip = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.1, 0.08, 0.16), darkMat);
  bumperLip.position.set(0, 0.36, -2.38);
  body.add(bumperLip);

  // ── Задние фонари (полоса на всю ширину) ──
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x330000,
    emissive: 0xff1a1a,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.34, 0.16, 0.06), tailMat);
  tail.position.set(0, 0.78, 2.42);
  body.add(tail);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.14, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xf5f2dc, roughness: 0.6 }),
  );
  plate.position.set(0, 0.58, 2.42);
  body.add(plate);

  // Зеркала
  for (const x of [-0.94, 0.94]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.2), bodyMat);
    mirror.position.set(x, 1.02, -0.66);
    body.add(mirror);
  }

  // ── Дверь водителя (правая, передняя) ──
  const door = new THREE.Group();
  door.name = 'door';
  door.position.set(0.86, 0, -0.78);
  const doorOpening = new THREE.Mesh(
    new THREE.PlaneGeometry(1.04, 0.56),
    new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 1 }),
  );
  doorOpening.rotation.y = Math.PI / 2;
  doorOpening.position.set(0.885, 0.64, -0.26);
  body.add(doorOpening);
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.56, 1.04), bodyMat);
  doorPanel.position.set(0.03, 0.64, 0.54);
  door.add(doorPanel);
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.96), glassMat);
  doorGlass.position.set(0.02, 1.12, 0.56);
  door.add(doorGlass);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.16), chromeMat);
  handle.position.set(0.07, 0.8, 0.86);
  door.add(handle);
  body.add(door);

  // ── Колёса ──
  const wheelPivots: THREE.Group[] = [];
  const wheelMeshes: THREE.Mesh[] = [];
  const tireGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.25, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.26, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 });
  const spokeGeo = new THREE.BoxGeometry(0.27, 0.05, 0.36);
  const wheelDefs: Array<[number, number]> = [
    [-CAR.track / 2 - 0.04, -CAR.wheelbase / 2],
    [CAR.track / 2 + 0.04, -CAR.wheelbase / 2],
    [-CAR.track / 2 - 0.04, CAR.wheelbase / 2],
    [CAR.track / 2 + 0.04, CAR.wheelbase / 2],
  ];
  for (const [x, z] of wheelDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(x, CAR.wheelRadius, z);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const rim = new THREE.Mesh(rimGeo, chromeMat);
    tire.add(rim);
    for (let k = 0; k < 3; k++) {
      const spoke = new THREE.Mesh(spokeGeo, chromeMat);
      spoke.rotation.x = (k / 3) * Math.PI;
      tire.add(spoke);
    }
    pivot.add(tire);
    root.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(tire);
  }

  // ── Неон ──
  const neonLight = new THREE.PointLight(0xff2d95, 38, 9, 2);
  neonLight.position.set(0, 0.16, 0);
  root.add(neonLight);
  const neonStripMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0xff2d95,
    emissiveIntensity: 3,
  });
  for (const x of [-0.84, 0.84]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 3.4), neonStripMat);
    strip.position.set(x, 0.33, 0.1);
    body.add(strip);
  }
  const neonGlowMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(256),
    color: 0xff2d95,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.2), neonGlowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  root.add(glow);

  // ── Спойлер ──
  const spoiler = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.32), bodyMat);
  wing.position.set(0, 1.24, 2.0);
  spoiler.add(wing);
  for (const x of [-0.55, 0.55]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), darkMat);
    stand.position.set(x, 1.08, 2.02);
    spoiler.add(stand);
  }
  spoiler.visible = false;
  body.add(spoiler);

  // ── Выхлоп ──
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 10), chromeMat);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(-0.55, 0.32, 2.4);
  body.add(exhaust);
  const exhaustFlameMat = new THREE.MeshBasicMaterial({
    color: 0xff9a2a,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const exhaustFlame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.6, 8), exhaustFlameMat);
  exhaustFlame.rotation.x = -Math.PI / 2;
  exhaustFlame.position.set(-0.55, 0.32, 2.85);
  exhaustFlame.visible = false;
  body.add(exhaustFlame);

  return {
    root,
    body,
    wheelPivots,
    wheelMeshes,
    door,
    headlights,
    headlightMat,
    tailMat,
    neonLight,
    neonGlowMat,
    neonStripMat,
    bodyMat,
    spoiler,
    seatAnchor,
    exhaustFlame,
    exhaustFlameMat,
  };
}

/**
 * Вытягиваем профиль (x_shape = z машины, y_shape = y) по ширине вдоль X.
 */
function extrudeProfile(
  shape: THREE.Shape,
  width: number,
  bevelThickness: number,
  bevelSize: number,
  bevelSegments: number,
): THREE.BufferGeometry {
  const depth = width - bevelThickness * 2;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: 6,
  });
  // shape (X, Y, Z) → car (-Z, Y, X): профиль вдоль z, экструзия вдоль x.
  geo.rotateY(-Math.PI / 2);
  geo.translate(depth / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}
