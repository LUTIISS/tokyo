import * as THREE from 'three';
import { makePetalTexture } from './textures';

/**
 * Лепестки сакуры — Points в коробке вокруг фокуса (камеры/машины), бесконечно падают и качаются.
 * intensity 0 — ничего, 1 — финал.
 */
export class Sakura {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private time = 0;
  private target = 0;
  private current = 0;

  constructor(count = 1800) {
    const seeds = new Float32Array(count * 3);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        intensity: { value: 0 },
        box: { value: new THREE.Vector3(90, 40, 90) },
        map: { value: makePetalTexture() },
        fogColor: { value: new THREE.Color(0) },
        fogNear: { value: 1 },
        fogFar: { value: 1000 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float time; uniform vec3 box;
        varying float vRot; varying float vFog;
        uniform float fogNear, fogFar;
        void main() {
          float fall = 0.7 + aSeed.y * 0.9;
          float sway = 1.2 + aSeed.z * 1.6;
          vec3 p;
          p.x = (aSeed.x - 0.5) * box.x + sin(time * 0.9 + aSeed.z * 6.2831) * sway;
          p.y = mod(aSeed.y * box.y * 3.0 - time * fall, box.y) - box.y * 0.35;
          p.z = (aSeed.z - 0.5) * box.z + cos(time * 0.7 + aSeed.x * 6.2831) * sway;
          vRot = time * (0.8 + aSeed.x) + aSeed.y * 6.2831;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vFog = smoothstep(fogNear, fogFar, dist);
          gl_PointSize = (5.0 + aSeed.x * 6.0) * (60.0 / max(dist, 1.0));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float intensity; uniform vec3 fogColor;
        varying float vRot; varying float vFog;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), co = cos(vRot);
          vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
          vec4 tex = texture2D(map, r);
          float a = tex.a * intensity;
          if (a < 0.02) discard;
          vec3 col = mix(tex.rgb, fogColor, vFog * 0.8);
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'sakura';
    this.points.renderOrder = 5;
  }

  setIntensity(t: number): void {
    this.target = t;
  }

  update(dt: number, focus: THREE.Vector3, fog: THREE.Fog): void {
    this.time += dt;
    this.current += (this.target - this.current) * Math.min(1, dt * 0.5);
    const u = this.points.material.uniforms;
    u.time.value = this.time;
    u.intensity.value = this.current;
    u.fogColor.value.copy(fog.color);
    u.fogNear.value = fog.near;
    u.fogFar.value = fog.far;
    this.points.position.set(focus.x, focus.y + 8, focus.z);
    this.points.visible = this.current > 0.01;
  }
}
