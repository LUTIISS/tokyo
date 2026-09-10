import * as THREE from 'three';
import { makeSmokeTexture } from '@/world/textures';

/**
 * Следы шин — кольцевой буфер квадов. Каждое колесо ведёт свою полосу.
 */
export class Skidmarks {
  readonly mesh: THREE.Mesh;
  private max: number;
  private head = 0;
  private positions: Float32Array;
  private colors: Float32Array;
  private last: Array<{ x: number; y: number; z: number; valid: boolean; lx: number; lz: number; rx: number; rz: number }> = [];
  private geo: THREE.BufferGeometry;
  private dirty = false;

  constructor(maxQuads = 1400, wheels = 4) {
    this.max = maxQuads;
    this.positions = new Float32Array(maxQuads * 4 * 3);
    this.colors = new Float32Array(maxQuads * 4 * 3);
    const indices = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) {
      const b = i * 4;
      indices.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'skidmarks';
    this.mesh.renderOrder = 1;
    for (let w = 0; w < wheels; w++) this.last.push({ x: 0, y: 0, z: 0, valid: false, lx: 0, lz: 0, rx: 0, rz: 0 });
  }

  /** Сообщить, что колесо не оставляет след (разрыв полосы). */
  lift(wheel: number): void {
    this.last[wheel].valid = false;
  }

  /**
   * Добавить точку следа. (px, pz) — правый вектор для ширины, intensity 0..1.
   */
  add(wheel: number, x: number, y: number, z: number, px: number, pz: number, intensity: number): void {
    const w = 0.13;
    const L = this.last[wheel];
    const lx = x - px * w;
    const lz = z - pz * w;
    const rx = x + px * w;
    const rz = z + pz * w;
    if (L.valid) {
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < 0.22) return;
      if (d > 4) {
        L.valid = false;
      } else {
        const q = this.head;
        this.head = (this.head + 1) % this.max;
        const base = q * 12;
        const yy = y + 0.015;
        this.positions.set([L.lx, L.y + 0.015, L.lz, L.rx, L.y + 0.015, L.rz, lx, yy, lz, rx, yy, rz], base);
        const asphalt = 0.16;
        const c = asphalt * (1 - intensity) + 0.02 * intensity;
        for (let k = 0; k < 4; k++) this.colors.set([c, c, c + 0.01], base + k * 3);
        this.dirty = true;
      }
    }
    L.x = x;
    L.y = y;
    L.z = z;
    L.lx = lx;
    L.lz = lz;
    L.rx = rx;
    L.rz = rz;
    L.valid = true;
  }

  flush(): void {
    if (!this.dirty) return;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.dirty = false;
  }
}

/**
 * Дым покрышек — Points с кольцевым буфером; вся анимация в шейдере.
 */
export class Smoke {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private max: number;
  private head = 0;
  private time = 0;
  private aPos: THREE.BufferAttribute;
  private aVel: THREE.BufferAttribute;
  private aBirth: THREE.BufferAttribute;
  private aLife: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private dirty = false;

  constructor(max = 600) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aBirth = new THREE.BufferAttribute(new Float32Array(max).fill(-100), 1).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(new Float32Array(max).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aBirth', this.aBirth);
    geo.setAttribute('aLife', this.aLife);
    geo.setAttribute('aSize', this.aSize);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        map: { value: makeSmokeTexture() },
        tint: { value: new THREE.Color(0xff2d95) },
        fogColor: { value: new THREE.Color(0) },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aVel; attribute float aBirth, aLife, aSize;
        uniform float time, fogNear, fogFar;
        varying float vAlpha; varying float vFog;
        void main() {
          float age = time - aBirth;
          float t = age / aLife;
          vec3 p = position + aVel * age + vec3(0.0, 1.4 * age + 0.6 * age * age, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          if (t < 0.0 || t > 1.0) { gl_PointSize = 0.0; vAlpha = 0.0; }
          else {
            gl_PointSize = aSize * (0.7 + 2.6 * t) * (240.0 / max(dist, 1.0));
            vAlpha = (1.0 - t) * smoothstep(0.0, 0.08, t) * 0.5;
          }
          vFog = smoothstep(fogNear, fogFar, dist);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 tint, fogColor;
        varying float vAlpha, vFog;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          float a = tex.a * vAlpha;
          if (a < 0.01) discard;
          vec3 col = mix(vec3(0.72, 0.72, 0.76), tint, 0.28);
          col = mix(col, fogColor, vFog);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'tire-smoke';
    this.points.renderOrder = 4;
  }

  setTint(hex: number): void {
    (this.points.material.uniforms.tint.value as THREE.Color).set(hex);
  }

  emit(x: number, y: number, z: number, vx: number, vz: number, size: number, life = 1.4): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.aPos.setXYZ(i, x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    this.aVel.setXYZ(i, vx + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.4, vz + (Math.random() - 0.5) * 1.2);
    this.aBirth.setX(i, this.time);
    this.aLife.setX(i, life * (0.75 + Math.random() * 0.5));
    this.aSize.setX(i, size * (0.8 + Math.random() * 0.5));
    this.dirty = true;
  }

  update(dt: number, fog: THREE.Fog): void {
    this.time += dt;
    const u = this.points.material.uniforms;
    u.time.value = this.time;
    u.fogColor.value.copy(fog.color);
    u.fogNear.value = fog.near;
    u.fogFar.value = fog.far;
    if (this.dirty) {
      this.aPos.needsUpdate = true;
      this.aVel.needsUpdate = true;
      this.aBirth.needsUpdate = true;
      this.aLife.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.dirty = false;
    }
  }
}
