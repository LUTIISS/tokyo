import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { ECONOMY, PLAYER } from '@/config';
import { Input } from './Input';
import { GameState, formatYen } from './GameState';
import { World } from '@/world/World';
import { makeNeonEnvironment } from '@/world/EnvMap';
import { Car } from '@/entities/Car';
import type { CarInput } from '@/entities/CarPhysics';
import { Player } from '@/entities/Player';
import { Boss } from '@/entities/Boss';
import { CameraRig } from '@/camera/CameraRig';
import { AudioManager } from '@/audio/AudioManager';
import { HUD } from '@/ui/HUD';
import { GarageMenu } from '@/ui/GarageMenu';
import { Overlays } from '@/ui/Overlays';
import { MiniMap } from '@/ui/MiniMap';
import { ObjectiveMarker } from '@/ui/ObjectiveMarker';
import { TurnIndicator } from '@/ui/TurnIndicator';
import { OverlookGiftQuest, type Quest } from '@/quests/Quest';
import type { Sector } from '@/world/Track';
import type { ZoneId } from '@/world/Zones';

type Mode =
  | 'loading'
  | 'intro'
  | 'walk'
  | 'entering'
  | 'drive'
  | 'exiting'
  | 'garage'
  | 'quest'
  | 'boss'
  | 'bossfight'
  | 'finale'
  | 'paused';

interface Timer {
  at: number;
  fn: () => void;
}

/**
 * Главный класс: рендер, цикл, машина состояний и склейка всех систем.
 */
export class Game {
  readonly state = new GameState();
  readonly input = new Input();
  readonly audio = new AudioManager();
  readonly scene = new THREE.Scene();

  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private bloomEnabled = true;
  private cameraRig!: CameraRig;
  private world!: World;
  private car!: Car;
  private player!: Player;
  private boss = new Boss();
  private hud!: HUD;
  private overlays!: Overlays;
  private garage!: GarageMenu;
  private minimap!: MiniMap;
  private marker!: ObjectiveMarker;
  private turns!: TurnIndicator;
  private quest: Quest = new OverlookGiftQuest();

  private mode: Mode = 'loading';
  private modeBeforePause: Mode = 'walk';
  private timer = new THREE.Timer();
  private time = 0;
  private timers: Timer[] = [];
  private lastSector: Sector | null = null;
  private dayTarget = 0;
  private gateWarnAt = -10;
  private prevImpact = 0;
  private focus = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpF = new THREE.Vector3();
  private tmpR = new THREE.Vector3();

  constructor(
    private app: HTMLElement,
    private ui: HTMLElement,
  ) {}

  async init(): Promise<void> {
    // ── Рендер ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.app.appendChild(this.renderer.domElement);

    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cameraRig.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // ── UI ──
    this.overlays = new Overlays(this.ui);
    this.overlays.showIntro(() => this.start());
    this.hud = new HUD(this.ui);
    this.hud.setHelp([
      ['WASD', 'Ходить / ехать'],
      ['Space', 'Ручник'],
      ['Shift', 'Бег / нитро'],
      ['E', 'Сесть · действие · выйти'],
      ['C', 'Камера'],
      ['R', 'На трассу'],
      ['N · M', 'Трек · звук'],
      ['H', 'Скрыть подсказки'],
    ]);
    this.garage = new GarageMenu(this.ui, this.state, {
      onChange: () => this.car.applyUpgrades(this.state.upgrades),
      onClose: () => this.closeGarage(),
    });

    // ── Мир ──
    this.world = new World(this.scene);
    await this.world.build((msg) => this.overlays.setIntroStatus(msg));

    // ── Карта и маркер цели ──
    this.minimap = new MiniMap(this.hud.root, this.ui, this.world.track, this.world.plan);
    this.hud.mountBottomLeft(this.minimap.root);
    this.hud.setHelpVisible(false);
    this.marker = new ObjectiveMarker(this.hud.root);
    this.turns = new TurnIndicator(this.hud.root, this.world.track);

    const envMap = makeNeonEnvironment(this.renderer);
    const water = this.scene.getObjectByName('water') as THREE.Mesh | null;
    if (water) {
      const m = water.material as THREE.MeshStandardMaterial;
      m.envMap = envMap;
      m.needsUpdate = true;
    }

    // ── Машина и персонаж ──
    this.car = new Car(this.scene, envMap);
    this.car.applyUpgrades(this.state.upgrades);
    this.car.physics.onDriftEnd = (score) => this.onDriftEnd(score);

    const start = this.world.track.at(30);
    const heading = Math.atan2(-start.tx, -start.tz);
    // Япония: левостороннее движение — паркуемся у левого тротуара.
    const cx = start.x - start.nx * 3.0;
    const cz = start.z - start.nz * 3.0;
    this.car.placeAt(cx, cz, heading, this.world.groundHeight(cx, cz));

    this.player = new Player();
    this.scene.add(this.player.group);
    this.scene.add(this.boss.group);
    const px = start.x - start.nx * 8.6 - start.tx * 3;
    const pz = start.z - start.nz * 8.6 - start.tz * 3;
    this.player.placeAt(px, pz, Math.atan2(-(cx - px), -(cz - pz)), this.world.groundHeight(px, pz));

    // ── Аудио ──
    this.audio.onTrackChange = (t, finale) => this.hud.setTrack(t?.title ?? null, finale);
    void this.audio.loadManifest();

    // ── Состояние ──
    this.state.onChange(() => this.refreshStateUI());
    this.refreshStateUI();
    this.hud.setYen(this.state.yen);

    if (this.state.data.bossDefeated) {
      this.dayTarget = 1;
      this.world.setDayness(1);
      this.world.props.setBlossom(1);
      this.world.sakura.setIntensity(0.5);
      this.world.zones.captureBase();
    }

    window.addEventListener('resize', () => this.onResize());
    this.timer.connect(document);
    this.mode = 'intro';
    this.cameraRig.setMode('intro', true);
    this.overlays.setIntroStatus('НАЖМИ, ЧТОБЫ НАЧАТЬ', true);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ─────────────────────────────────────────────────────────────────────
  // Старт / режимы
  // ─────────────────────────────────────────────────────────────────────

  start(): void {
    if (this.mode !== 'intro') return;
    this.audio.unlock();
    this.world.billboards.start();
    this.overlays.hideIntro();
    this.hud.setVisible(true);
    this.setMode('walk');
    this.cameraRig.setMode('walk');
    this.hud.toast('Андрюха, с днём рождения! Садись в тачку: <kbd>E</kbd> · <kbd>Tab</kbd> — карта · <kbd>H</kbd> — управление', 'good', 6000);
    const loc = this.world.locationAt(this.player.x, this.player.z);
    this.lastSector = loc.key;
    this.hud.showLocation(loc.jp, loc.ru);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.input.captured = m === 'garage' || m === 'quest' || m === 'paused' || m === 'boss';
  }

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  /** Текущая цель по сюжету. */
  private objectiveId(): ZoneId | null {
    const d = this.state.data;
    if (!d.questDone) return 'quest';
    if (!d.upgrades.bigUpgrade) return 'garage';
    if (!d.bossDefeated) return 'boss';
    return null;
  }

  private refreshStateUI(): void {
    this.hud.setYen(this.state.yen);
    const d = this.state.data;
    let line: string;
    let done = false;
    if (!d.questDone) line = 'Подарок ждёт на <b>смотровой площадке</b> (розовый маяк за перевалом)';
    else if (!d.upgrades.bigUpgrade) line = `Мастерская: купить <b>большой апгрейд</b> за ${formatYen(ECONOMY.bigUpgradeCost)}`;
    else if (!d.bossDefeated) line = 'Штурмовать <b>базу Ваисова</b> в порту';
    else {
      line = 'Весь Токио поздравляет Андрюху. Свободная езда.';
      done = true;
    }
    this.hud.setQuestLine(line, done);
    this.minimap?.setObjective(this.objectiveId());
  }

  // ─────────────────────────────────────────────────────────────────────
  // Цикл
  // ─────────────────────────────────────────────────────────────────────

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    if (dt > 0) this.update(dt);
    if (this.bloomEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.cameraRig.camera);
    this.input.endFrame();
  }

  private update(dt: number): void {
    // Таймеры кат-сцен
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }

    this.handleGlobalKeys();

    switch (this.mode) {
      case 'intro':
        this.car.update(dt, null, this.world, this.time);
        this.player.update(dt, null, this.cameraRig.yaw, this.world, [this.car.obb()]);
        break;
      case 'walk':
        this.updateWalk(dt);
        break;
      case 'entering':
      case 'exiting':
        this.player.update(dt, null, this.cameraRig.yaw, this.world, []);
        this.car.update(dt, null, this.world, this.time);
        break;
      case 'drive':
      case 'finale':
        this.updateDrive(dt);
        break;
      case 'bossfight':
        this.updateBossFight(dt);
        break;
      case 'garage':
      case 'quest':
      case 'boss':
        this.car.update(dt, null, this.world, this.time);
        break;
      case 'loading':
        break;
      case 'paused':
        break;
    }

    // День/ночь (финал)
    if (this.world.dayness !== this.dayTarget) {
      const d = this.dayTarget > this.world.dayness ? Math.min(this.dayTarget, this.world.dayness + dt / 28) : Math.max(this.dayTarget, this.world.dayness - dt / 28);
      this.world.setDayness(d);
      this.world.props.setBlossom(d);
    }

    // Босс живёт своей жизнью, пока идёт бой
    if (this.mode === 'bossfight' || this.boss.group.visible) {
      this.boss.update(dt, this.car.physics.x, this.car.physics.z, (x, z) => this.world.groundHeight(x, z));
    }

    // Фокус мира — машина или персонаж
    const driving = this.mode !== 'walk' && this.mode !== 'intro';
    if (driving) this.focus.copy(this.car.position);
    else this.focus.copy(this.player.position);
    if (this.mode !== 'paused') {
      this.world.update(dt, this.focus, this.cameraRig.camera.position, this.state.data.questDone);
    }

    // Камера
    const ph = this.car.physics;
    this.cameraRig.update(dt, {
      playerPos: this.player.position,
      playerHeading: this.player.heading,
      carPos: this.car.position,
      carForward: this.car.forward(this.tmpF),
      carRight: this.car.right(this.tmpR),
      carSpeed: ph.speed,
      carMaxSpeed: this.car.params.maxSpeed,
      carYawRate: ph.yawRate,
      carSlip: ph.slip,
      carImpact: ph.impact,
      groundHeight: (x, z) => this.world.groundHeight(x, z),
    });

    // Карта и маркер цели
    if (this.mode !== 'intro' && this.mode !== 'paused') {
      this.minimap.update(dt, {
        x: this.focus.x,
        z: this.focus.z,
        heading: driving ? ph.heading : this.player.heading,
        driving,
        carX: ph.x,
        carZ: ph.z,
        carHeading: ph.heading,
      });
      const poi = this.minimap.objectivePoi();
      const overlayMode =
        this.mode === 'garage' || this.mode === 'quest' || this.mode === 'boss' || this.mode === 'bossfight';
      if (poi && !overlayMode) {
        this.cameraRig.camera.updateMatrixWorld();
        this.tmpV.set(poi.x, this.world.groundHeight(poi.x, poi.z) + 7, poi.z);
        this.marker.update(this.cameraRig.camera, this.tmpV, poi.glyph, poi.color, this.minimap.distanceText(), window.innerWidth, window.innerHeight);
      } else {
        this.marker.hide();
      }

      // Стрелка следующего поворота — только за рулём и на ходу
      const drivingFast = driving && Math.abs(ph.speed) > 3;
      if (drivingFast && !overlayMode) {
        const near = this.world.track.nearest(ph.x, ph.z);
        const forward = ph.forwardX * near.sample.tx + ph.forwardZ * near.sample.tz >= 0;
        this.turns.update(this.turns.lookAhead(ph.x, ph.z, forward), true);
      } else {
        this.turns.update({ kind: 'straight', distance: 0, severity: 0 }, false);
      }
    }

    this.hud.update(dt);

    // Локация
    if (this.mode === 'walk' || this.mode === 'drive' || this.mode === 'finale') {
      const loc = this.world.locationAt(this.focus.x, this.focus.z);
      if (loc.key !== this.lastSector) {
        this.lastSector = loc.key;
        this.hud.showLocation(loc.jp, loc.ru);
      }
    }
  }

  private handleGlobalKeys(): void {
    if (this.mode === 'intro' || this.mode === 'loading') return;
    if (this.input.justPressedRaw('Escape')) {
      if (this.minimap.isBigOpen) this.minimap.toggleBig(false);
      else if (this.mode === 'garage') this.garage.close();
      else if (this.mode === 'paused') this.resume();
      else if (this.mode === 'walk' || this.mode === 'drive' || this.mode === 'finale') this.pause();
      return;
    }
    if (this.input.justPressedRaw('Tab') && (this.mode === 'walk' || this.mode === 'drive' || this.mode === 'finale' || this.mode === 'bossfight')) {
      this.minimap.toggleBig();
    }
    if (this.input.justPressed('KeyH')) this.hud.toggleHelp();
    if (this.input.justPressed('KeyN')) this.audio.next();
    if (this.input.justPressed('KeyM')) {
      const muted = this.audio.toggleMute();
      this.hud.toast(muted ? 'Звук выключен' : 'Звук включён', 'info', 1200);
    }
    if (this.input.justPressed('KeyB')) {
      this.bloomEnabled = !this.bloomEnabled;
      this.hud.toast(this.bloomEnabled ? 'Bloom включён' : 'Bloom выключен', 'info', 1200);
    }
  }

  // ── Ходьба ──
  private updateWalk(dt: number): void {
    this.player.update(dt, this.input, this.cameraRig.yaw, this.world, [this.car.obb()]);
    this.car.update(dt, null, this.world, this.time);
    const door = this.car.doorPoint(this.tmpV);
    const d = Math.hypot(door.x - this.player.x, door.z - this.player.z);
    const near = d < PLAYER.enterRadius + 1.2;
    this.hud.setPrompt(near ? 'Сесть в машину' : null);
    if (near && this.input.interact) this.beginEnter();
  }

  private beginEnter(): void {
    this.setMode('entering');
    this.hud.setPrompt(null);
    this.car.openDoor();
    const door = this.car.doorPoint(new THREE.Vector3());
    // Стоим у двери лицом к машине (влево от двери — центр машины)
    const faceHeading = Math.atan2(-(this.car.position.x - door.x), -(this.car.position.z - door.z));
    this.player.walkTo(door, faceHeading, () => {
      this.after(0.25, () => {
        this.player.setSeated(true, this.car.model.seatAnchor);
      });
      this.after(0.7, () => {
        this.car.closeDoor();
      });
      this.after(1.2, () => {
        this.car.setEngine(true);
        this.cameraRig.setMode('chase');
      });
      this.after(1.7, () => {
        this.setMode('drive');
        this.hud.toast('Поехали, именинник. <kbd>Space</kbd> — ручник, дрифтуй.', 'info', 3500);
      });
    });
  }

  private beginExit(): void {
    this.setMode('exiting');
    this.hud.setPrompt(null);
    this.car.setEngine(false);
    this.car.openDoor();
    this.after(0.55, () => {
      const door = this.car.doorPoint(new THREE.Vector3());
      this.player.setSeated(false);
      this.scene.add(this.player.group);
      const away = Math.atan2(-(door.x - this.car.position.x), -(door.z - this.car.position.z));
      this.player.placeAt(door.x, door.z, away, this.world.groundHeight(door.x, door.z));
      this.cameraRig.setMode('walk');
    });
    this.after(1.1, () => {
      this.car.closeDoor();
      this.setMode('walk');
    });
  }

  // ── Езда ──
  private updateDrive(dt: number): void {
    const dialog = this.overlays.dialogOpen;
    const inp: CarInput | null = dialog
      ? null
      : {
          throttle: this.input.throttle,
          brake: this.input.brake,
          steer: this.input.steer,
          handbrake: this.input.handbrake,
          nitro: this.input.run,
        };
    this.car.update(dt, inp, this.world, this.time);
    const ph = this.car.physics;

    if (this.input.justPressed('KeyC')) this.cameraRig.nextChaseVariant();
    if (this.input.justPressed('KeyR')) this.resetCarToRoad();

    // Удары
    if (ph.impact > 0.45 && this.prevImpact <= 0.45) {
      this.cameraRig.shake(ph.impact);
    }
    this.prevImpact = ph.impact;

    // HUD
    this.hud.setSpeed(ph.speedKmh, ph.gear, ph.rpm, ph.speed < -0.5);
    this.hud.setDrift(ph.drifting, ph.driftScore, ph.driftCombo);
    this.hud.setNitro(this.car.params.nitro ? ph.nitroCharge : null);

    // Зоны
    const slow = ph.speedKmh < 8;
    const zone = this.world.zones.zoneAt(ph.x, ph.z);
    let prompt: string | null = null;
    if (zone?.id === 'quest' && !this.state.data.questDone) {
      prompt = slow ? 'Начать квест' : 'Остановись, чтобы начать квест';
      if (slow && this.input.interact) this.openQuest();
    } else if (zone?.id === 'garage') {
      prompt = slow ? 'Открыть тюнинг' : 'Остановись в мастерской';
      if (slow && this.input.interact) this.openGarage();
    } else if (zone?.id === 'boss' && !this.state.data.bossDefeated) {
      if (this.state.upgrades.bigUpgrade) {
        prompt = slow ? 'Победить Ваисова' : 'Остановись перед воротами';
        if (slow && this.input.interact) this.startBoss();
      } else if (this.time - this.gateWarnAt > 6) {
        this.gateWarnAt = this.time;
        this.hud.toast('Ворота заперты. Нужен <b>флюгегехаймен</b> из мастерской.', 'warn', 3500);
      }
    } else if (slow && Math.abs(ph.speed) < 1.5) {
      prompt = 'Выйти из машины';
      if (this.input.interact) this.beginExit();
    }
    if (this.mode === 'drive' || this.mode === 'finale') this.hud.setPrompt(prompt);
  }

  private resetCarToRoad(): void {
    const ph = this.car.physics;
    const near = this.world.track.nearest(ph.x, ph.z);
    const s = near.sample;
    const heading = Math.atan2(-s.tx, -s.tz);
    const x = s.x - s.nx * 2.6;
    const z = s.z - s.nz * 2.6;
    this.car.placeAt(x, z, heading, this.world.groundHeight(x, z));
    this.cameraRig.setMode('chase', true);
    this.hud.toast('Машина на трассе', 'info', 1200);
  }

  private onDriftEnd(score: number): void {
    if (score < 40) return;
    this.state.recordDrift(score);
    this.hud.toast(`ДРИФТ +${score.toLocaleString('ru-RU')}`, 'good', 1500);
  }

  // ── Квест ──
  private openQuest(): void {
    this.setMode('quest');
    this.hud.setPrompt(null);
    const q = this.quest;
    this.overlays.showDialog({
      kicker: q.kicker,
      title: q.title,
      body: q.description,
      onClose: () => this.setMode('drive'),
      actions: [
        {
          label: 'Принять подарок',
          primary: true,
          onClick: () => {
            q.start();
            this.state.completeQuest(q.reward);
            this.overlays.closeDialog();
            this.setMode('drive');
            this.hud.toast(`Подарок принят! <b>+${formatYen(q.reward)}</b>. Теперь — в мастерскую.`, 'good', 4500);
          },
        },
        {
          label: 'Позже',
          key: 'Escape',
          onClick: () => {
            this.overlays.closeDialog();
            this.setMode('drive');
          },
        },
      ],
    });
  }

  // ── Гараж ──
  private openGarage(): void {
    this.setMode('garage');
    this.hud.setPrompt(null);
    this.car.setEngine(false);
    this.cameraRig.setMode('showroom');
    this.garage.open();
  }

  private closeGarage(): void {
    if (this.mode !== 'garage') return;
    this.car.setEngine(true);
    this.cameraRig.setMode('chase');
    this.setMode('drive');
  }

  // ── Босс ──
  /** Короткая кат-сцена: ворота сносим флюгегехайменом, во двор выходит Ваисов. */
  private startBoss(): void {
    this.setMode('boss');
    this.hud.setPrompt(null);
    this.hud.setDrift(false, 0, 1);
    this.overlays.cutsceneBars(true);
    const f = this.world.zones.bossFocus();
    const carPos = this.car.position.clone();
    const up = new THREE.Vector3(0, 1, 0);
    const from = carPos.clone().addScaledVector(f.along, 9).addScaledVector(f.inward, -5).addScaledVector(up, 2.5);
    const to = f.gate.clone().addScaledVector(f.inward, -9).addScaledVector(f.along, 4).addScaledVector(up, 7);
    this.cameraRig.cinematic(from, to, carPos.clone().addScaledVector(up, 1), f.gate, 4);
    this.overlays.subtitle('Кто посмел праздновать день рождения на моём районе?!', 'ВАИСОВ');

    this.after(2.4, () => {
      this.world.zones.openGate();
      this.cameraRig.shake(1);
      this.overlays.subtitle('Флюгегехаймен сносит ворота.', 'ФЛЮГЕГЕХАЙМЕН');
    });
    this.after(4.6, () => {
      // Ваисов выходит в центр двора
      const yard = f.yard;
      const heading = Math.atan2(-(carPos.x - yard.x), -(carPos.z - yard.z));
      this.boss.spawn(yard.x, yard.z, this.world.groundHeight(yard.x, yard.z), heading);
      const camPos = yard.clone().addScaledVector(f.inward, -16).addScaledVector(f.along, 10).addScaledVector(up, 6);
      this.cameraRig.cinematic(to, camPos, f.gate, yard.clone().setY(yard.y + 2), 3.4);
      this.overlays.subtitle('Ну давай, посмотрим, что у тебя там из капота торчит.', 'ВАИСОВ');
    });
    this.after(8.0, () => this.beginBossFight());
  }

  /** Сам бой: заезжаешь во двор и долбишь Ваисова флюгегехайменом на Shift. */
  private beginBossFight(): void {
    this.overlays.subtitle(null);
    this.overlays.cutsceneBars(false);
    this.cameraRig.setMode('chase');
    this.setMode('bossfight');
    this.hud.setBoss(true, this.boss.hp, this.boss.maxHp, 'Разгонись и держи <kbd>Shift</kbd> — флюгегехаймен достанет его');
    this.hud.toast('Таранить только флюгегехайменом. <kbd>Shift</kbd>!', 'warn', 4000);
  }

  private updateBossFight(dt: number): void {
    const inp: CarInput = {
      throttle: this.input.throttle,
      brake: this.input.brake,
      steer: this.input.steer,
      handbrake: this.input.handbrake,
      nitro: this.input.run,
    };
    this.car.update(dt, inp, this.world, this.time);
    const ph = this.car.physics;

    if (this.input.justPressed('KeyC')) this.cameraRig.nextChaseVariant();
    this.hud.setSpeed(ph.speedKmh, ph.gear, ph.rpm, ph.speed < -0.5);
    this.hud.setNitro(this.car.params.nitro ? ph.nitroCharge : null);
    this.hud.setDrift(ph.drifting, ph.driftScore, ph.driftCombo);

    if (!this.boss.group.visible || this.boss.phase === 'defeated') return;

    // Ваисов «просыпается» и начинает бегать, как только машина тронулась
    if (this.boss.phase === 'taunt' && ph.speedKmh > 12) this.boss.phase = 'fight';

    const dx = this.boss.x - ph.x;
    const dz = this.boss.z - ph.z;
    const dist = Math.hypot(dx, dz);
    const fl = this.car.fluegel;

    // Попадание: шток выброшен до упора и достаёт до тела
    if (fl.installed && fl.active && dist < fl.maxReach + this.boss.radius + 1.2 && fl.consumeStrike()) {
      // Кончик должен смотреть примерно в него
      const aim = (ph.forwardX * dx + ph.forwardZ * dz) / (dist || 1);
      if (aim > 0.45 && this.boss.takeHit(ph.x, ph.z, 1 + Math.min(1, ph.speedKmh / 90))) {
        this.cameraRig.shake(0.9);
        this.hud.setBoss(true, this.boss.hp, this.boss.maxHp, this.boss.hp > 0 ? `Осталось ударов: <b>${this.boss.hp}</b>` : 'Ваисов повержен');
        const tip = fl.tipWorld(this.tmpV);
        for (let i = 0; i < 8; i++) {
          this.car.smoke.emit(tip.x, tip.y, tip.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 1.6, 0.8);
        }
        if (this.boss.hp === 0) this.onBossDefeated();
      }
    }

    // Об Ваисова просто так не проехать — отталкивает машину
    const solid = this.boss.radius + 1.3;
    if (dist < solid && dist > 0.001) {
      const nx = dx / dist;
      const nz = dz / dist;
      const push = solid - dist;
      ph.x -= nx * push;
      ph.z -= nz * push;
      const vn = ph.vx * nx + ph.vz * nz;
      if (vn > 0) {
        ph.vx -= nx * vn * 1.4;
        ph.vz -= nz * vn * 1.4;
        if (vn > 6) {
          ph.impact = Math.min(1, vn / 14);
        }
      }
    }
  }

  private onBossDefeated(): void {
    this.hud.setBoss(true, 0, this.boss.maxHp, 'Ваисов повержен');
    this.setMode('boss');
    this.overlays.cutsceneBars(true);
    const f = this.world.zones.bossFocus();
    const up = new THREE.Vector3(0, 1, 0);
    const bossPos = new THREE.Vector3(this.boss.x, this.boss.y + 1, this.boss.z);
    const cam = bossPos.clone().addScaledVector(f.inward, -13).addScaledVector(f.along, 9).addScaledVector(up, 8);
    this.cameraRig.cinematic(this.cameraRig.camera.position.clone(), cam, bossPos, bossPos, 2.6);
    this.overlays.subtitle('Всё, всё! Поздравляю, Андрюха, только убери эту штуку!', 'ВАИСОВ');

    this.after(3.2, () => {
      this.world.zones.captureBase();
      this.overlays.subtitle('Клетка открыта. Аниме-девочки поздравляют Андрюху!', 'ПОБЕДА');
      const overCage = f.cage.clone().addScaledVector(f.inward, -12).addScaledVector(f.along, 6).addScaledVector(up, 6);
      this.cameraRig.cinematic(cam, overCage, bossPos, f.cage, 3.4);
    });
    this.after(6.6, () => {
      this.hud.setBoss(false);
      this.boss.hide();
      this.startFinale();
    });
  }

  private startFinale(): void {
    this.state.defeatBoss();
    this.overlays.subtitle(null);
    this.dayTarget = 1;
    this.world.sakura.setIntensity(1);
    this.audio.playFinale();
    this.overlays.showFinale('С ДНЁМ РОЖДЕНИЯ, АНДРЮХА!', 'Ночь кончилась · сакура цветёт · 誕生日おめでとう');
    this.setMode('finale');
    // Камера продолжает кружить над двором, затем возвращается к машине
    const f = this.world.zones.bossFocus();
    const yardCam = f.cage.clone().addScaledVector(f.inward, -26).addScaledVector(f.along, 18).add(new THREE.Vector3(0, 16, 0));
    this.cameraRig.cinematic(this.cameraRig.camera.position.clone(), yardCam, f.cage, f.cage, 9);
    this.after(9, () => {
      this.overlays.hideFinale();
      this.overlays.cutsceneBars(false);
      this.cameraRig.setMode('chase');
      this.setMode('drive');
      this.hud.toast('Весь Токио твой, Андрюха. Катайся сколько хочешь.', 'good', 5000);
    });
  }

  // ── Пауза ──
  private pause(): void {
    this.modeBeforePause = this.mode;
    this.setMode('paused');
    this.overlays.showDialog({
      kicker: '誕生日おめでとう',
      title: 'Пауза · с днём рождения, Андрюха',
      body: `
        <p>Иен: <b>${formatYen(this.state.yen)}</b> · Лучший дрифт: <b>${this.state.data.driftBest.toLocaleString('ru-RU')}</b></p>
        <p style="color:var(--muted)">Музыка: положи mp3 в <code>public/audio/tracks/</code>, мемы — в <code>public/media/billboards/</code>.</p>`,
      onClose: () => this.resume(),
      actions: [
        { label: 'Продолжить', primary: true, onClick: () => this.resume() },
        {
          label: 'На трассу',
          key: 'KeyR',
          onClick: () => {
            this.resume();
            if (this.mode === 'drive') this.resetCarToRoad();
          },
        },
        {
          label: this.bloomEnabled ? 'Bloom: вкл' : 'Bloom: выкл',
          key: 'KeyB',
          onClick: () => {
            this.bloomEnabled = !this.bloomEnabled;
            this.resume();
          },
        },
        {
          label: 'Сбросить прогресс',
          onClick: () => {
            if (confirm('Сбросить иены, апгрейды и сюжет?')) {
              this.state.reset();
              location.reload();
            }
          },
        },
      ],
    });
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.overlays.closeDialog();
    this.setMode(this.modeBeforePause);
    this.timer.reset();
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.cameraRig.resize(w / h);
  }
}
