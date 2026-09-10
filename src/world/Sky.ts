import * as THREE from 'three';
import { lerp } from './noise';

/**
 * Небо: купол-шейдер (градиент ночь/день), звёзды, луна, солнце,
 * плюс все источники освещения сцены и туман. Всё крутится одним параметром dayness ∈ [0, 1].
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly fog: THREE.Fog;
  dayness = 0;

  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private moon: THREE.Mesh;
  private sunDisc: THREE.Mesh;
  private time = 0;

  private readonly nightFog = new THREE.Color(0x0a0716);
  private readonly dayFog = new THREE.Color(0xd3e2f4);

  constructor(scene: THREE.Scene) {
    this.group.name = 'sky';

    // ── Купол ──
    const domeGeo = new THREE.SphereGeometry(1900, 48, 24);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        dayness: { value: 0 },
        nightZenith: { value: new THREE.Color(0x04041a) },
        nightHorizon: { value: new THREE.Color(0x2c1040) },
        nightGlow: { value: new THREE.Color(0x7a2a5a) },
        dayZenith: { value: new THREE.Color(0x3d7fd9) },
        dayHorizon: { value: new THREE.Color(0xd6e6f7) },
        sunDir: { value: new THREE.Vector3(0.3, 0.35, -0.5).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float dayness;
        uniform vec3 nightZenith, nightHorizon, nightGlow, dayZenith, dayHorizon, sunDir;
        varying vec3 vDir;
        void main() {
          float y = clamp(vDir.y, -0.2, 1.0);
          float t = pow(max(y, 0.0), 0.55);
          // Ночь: сверху почти чёрное, у горизонта — фиолетовый засвет города.
          vec3 night = mix(nightHorizon, nightZenith, t);
          float glow = pow(1.0 - clamp(y, 0.0, 1.0), 6.0);
          night += nightGlow * glow * 0.55;
          // День
          vec3 day = mix(dayHorizon, dayZenith, t);
          float sunAmt = max(dot(normalize(vDir), sunDir), 0.0);
          day += vec3(1.0, 0.85, 0.6) * pow(sunAmt, 18.0) * 0.8;
          day += vec3(1.0, 0.95, 0.85) * pow(sunAmt, 2.5) * 0.12;
          vec3 col = mix(night, day, dayness);
          // Рассветный оранжевый пояс на середине перехода
          float dawn = sin(clamp(dayness, 0.0, 1.0) * 3.14159);
          col += vec3(1.0, 0.45, 0.25) * dawn * glow * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // ── Звёзды ──
    const count = 1800;
    const sp = new Float32Array(count * 3);
    const ss = new Float32Array(count);
    const sph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(1 - v); // верхняя полусфера
      const r = 1800;
      const y = Math.cos(phi);
      if (y < 0.03) {
        sp[i * 3 + 1] = -100; // спрятать под горизонт
        continue;
      }
      sp[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      sp[i * 3 + 1] = r * y;
      sp[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      ss[i] = 1.2 + Math.random() * 2.4;
      sph[i] = Math.random() * Math.PI * 2;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
    const starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { dayness: { value: 0 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aPhase;
        uniform float time; varying float vA;
        void main() {
          vA = 0.55 + 0.45 * sin(time * 1.7 + aPhase);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (600.0 / -mv.z) * 3.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float dayness; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.05, d) * vA * (1.0 - dayness);
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
        }
      `,
    });
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // ── Луна ──
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xf4f1e0, fog: false });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(42, 24, 16), moonMat);
    this.moon.position.set(-700, 900, -1200);
    this.group.add(this.moon);
    const moonHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xc8d4ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    moonHalo.scale.set(360, 360, 1);
    this.moon.add(moonHalo);

    // ── Солнце (диск) ──
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(60, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8, fog: false }),
    );
    this.sunDisc.position.set(520, 620, -900);
    this.sunDisc.visible = false;
    this.group.add(this.sunDisc);

    // ── Свет ──
    this.hemi = new THREE.HemisphereLight(0x5464a8, 0x1c1226, 0.38);
    this.sun = new THREE.DirectionalLight(0x9fb2ff, 0.3);
    this.sun.position.set(-500, 700, -800);
    this.group.add(this.hemi, this.sun);

    this.fog = new THREE.Fog(this.nightFog.clone(), 40, 1050);
    scene.fog = this.fog;
    scene.background = this.nightFog.clone();

    scene.add(this.group);
    this.setDayness(0);
  }

  setDayness(t: number): void {
    this.dayness = t;
    this.dome.material.uniforms.dayness.value = t;
    this.stars.material.uniforms.dayness.value = t;

    // Свет
    const nightSky = new THREE.Color(0x5464a8);
    const daySky = new THREE.Color(0xbfd8ff);
    const nightGround = new THREE.Color(0x1c1226);
    const dayGround = new THREE.Color(0x8c7f66);
    this.hemi.color.copy(nightSky).lerp(daySky, t);
    this.hemi.groundColor.copy(nightGround).lerp(dayGround, t);
    this.hemi.intensity = lerp(0.38, 1.1, t);

    const moonCol = new THREE.Color(0x9fb2ff);
    const sunCol = new THREE.Color(0xfff1d6);
    this.sun.color.copy(moonCol).lerp(sunCol, t);
    this.sun.intensity = lerp(0.3, 2.8, t);
    // Солнце «встаёт» с востока
    const moonPos = new THREE.Vector3(-500, 700, -800);
    const sunPos = new THREE.Vector3(600, 520, -700);
    this.sun.position.copy(moonPos).lerp(sunPos, t);

    this.moon.visible = t < 0.85;
    (this.moon.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    (this.moon.material as THREE.MeshBasicMaterial).transparent = true;
    this.sunDisc.visible = t > 0.15;
    this.sunDisc.position.set(600, lerp(-100, 620, t), -900);

    // Туман
    const fogNear = lerp(40, 90, t);
    const fogFar = lerp(1050, 1700, t);
    this.fog.near = fogNear;
    this.fog.far = fogFar;
    this.fog.color.copy(this.nightFog).lerp(this.dayFog, t);
    // Рассветная тёплая примесь
    const dawn = Math.sin(t * Math.PI);
    this.fog.color.lerp(new THREE.Color(0xf0a070), dawn * 0.25);
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;
    this.stars.material.uniforms.time.value = this.time;
    // Купол и звёзды следуют за камерой, чтобы никогда не кончаться.
    this.dome.position.copy(cameraPos);
    this.stars.position.copy(cameraPos);
    this.moon.position.set(cameraPos.x - 700, 900, cameraPos.z - 1200);
    this.sunDisc.position.x = cameraPos.x + 600;
    this.sunDisc.position.z = cameraPos.z - 900;
    // Направленный свет тоже держим у камеры (target — по умолчанию (0,0,0))
    this.sun.target.position.copy(cameraPos);
    this.sun.position.copy(cameraPos).add(this.sunOffset());
    this.sun.target.updateMatrixWorld();
  }

  private sunOffset(): THREE.Vector3 {
    const t = this.dayness;
    return new THREE.Vector3(lerp(-500, 600, t), lerp(700, 520, t), lerp(-800, -700, t));
  }
}

export function makeGlowTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
