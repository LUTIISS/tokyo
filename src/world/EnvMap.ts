import * as THREE from 'three';

/**
 * Карта окружения для отражений на кузове: тёмное небо + неоновые полосы у горизонта
 * + тёплые «фонари» сверху. Генерируется один раз через PMREM.
 */
export function makeNeonEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();

  // Купол с вертикальным градиентом (vertex colors)
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x05060f);
  const mid = new THREE.Color(0x1a0a2a);
  const bottom = new THREE.Color(0x0a0812);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50; // -1..1
    if (y >= 0) tmp.copy(mid).lerp(top, Math.pow(y, 0.6));
    else tmp.copy(mid).lerp(bottom, Math.pow(-y, 0.5));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  scene.add(dome);

  const strip = (color: THREE.Color, azimuth: number, elevation: number, w: number, h: number, dist = 40) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    const x = Math.cos(elevation) * Math.sin(azimuth) * dist;
    const y = Math.sin(elevation) * dist;
    const z = Math.cos(elevation) * Math.cos(azimuth) * dist;
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };

  // Неон по горизонту
  const pink = new THREE.Color(2.4, 0.3, 1.3);
  const cyan = new THREE.Color(0.2, 2.2, 2.6);
  const violet = new THREE.Color(1.2, 0.5, 2.6);
  for (let i = 0; i < 10; i++) {
    const az = (i / 10) * Math.PI * 2;
    const col = i % 3 === 0 ? pink : i % 3 === 1 ? cyan : violet;
    strip(col, az, 0.05 + (i % 2) * 0.06, 12, 1.2);
  }
  // Тёплые фонари сверху
  const warm = new THREE.Color(3.2, 2.6, 1.9);
  for (let i = 0; i < 6; i++) {
    const az = (i / 6) * Math.PI * 2 + 0.3;
    strip(warm, az, 0.9, 6, 2.5);
  }
  // Холодная «луна»
  strip(new THREE.Color(1.8, 2.0, 2.6), 2.4, 1.2, 8, 8);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(scene, 0.04, 0.1, 200);
  pmrem.dispose();
  geo.dispose();
  return rt.texture;
}
