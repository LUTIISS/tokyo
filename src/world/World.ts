import * as THREE from 'three';
import { ROAD, WORLD } from '@/config';
import type { GroundQuery } from '@/entities/CarPhysics';
import { Terrain } from './Terrain';
import { Track, type Sector } from './Track';
import { Sky } from './Sky';
import { City } from './City';
import { Props } from './Props';
import { Billboards } from './Billboards';
import { Posters } from './Posters';
import { Sakura } from './Sakura';
import { Zones, planZones, type ZonePlan } from './Zones';
import { Colliders } from './Colliders';
import { lerp, smoothstep } from './noise';

export interface LocationInfo {
  key: Sector;
  jp: string;
  ru: string;
}

const LOCATIONS: Record<Sector, LocationInfo> = {
  city: { key: 'city', jp: '渋谷', ru: 'Сибуя · Ночной проспект' },
  bridge: { key: 'bridge', jp: '湾岸', ru: 'Ванган · Мост через залив' },
  touge: { key: 'touge', jp: '峠', ru: 'Тогэ · Горный перевал' },
  overlook: { key: 'overlook', jp: '展望台', ru: 'Смотровая площадка' },
  industrial: { key: 'industrial', jp: '工場地帯', ru: 'Промзона · Мастерская' },
  docks: { key: 'docks', jp: '港', ru: 'Порт · База Ваисова' },
};

/**
 * Весь мир целиком. Строится процедурно за секунду-две.
 */
export class World {
  readonly terrain: Terrain;
  readonly track: Track;
  readonly colliders = new Colliders();
  readonly sky: Sky;
  readonly city: City;
  readonly props: Props;
  readonly billboards: Billboards;
  readonly posters: Posters;
  readonly sakura: Sakura;
  readonly zones: Zones;
  readonly plan: ZonePlan;
  dayness = 0;
  private time = 0;

  constructor(readonly scene: THREE.Scene) {
    this.terrain = new Terrain();
    this.track = new Track(this.terrain);
    this.terrain.flattenAlong(this.track.samples);
    this.plan = planZones(this.track);
    this.zones = new Zones(this.track, this.terrain, this.colliders, this.plan);
    this.zones.flattenTerrain();
    this.sky = new Sky(scene);
    this.city = new City(this.track, this.terrain, this.colliders, this.plan.exclusions);
    this.props = new Props(this.track, this.terrain, this.colliders);
    this.billboards = new Billboards(this.track, this.terrain);
    this.posters = new Posters(this.track, this.terrain, this.colliders);
    this.sakura = new Sakura();
  }

  /** Пошаговая сборка, чтобы интро успевало обновлять статус. */
  async build(progress: (msg: string) => void): Promise<void> {
    const step = async (msg: string, fn: () => void) => {
      progress(msg);
      await new Promise((r) => setTimeout(r, 0));
      fn();
    };
    await step('Насыпаем горы и залив…', () => {
      this.scene.add(this.terrain.buildMesh());
      this.scene.add(this.terrain.buildWater());
    });
    await step('Кладём асфальт…', () => {
      this.scene.add(this.track.buildMeshes());
    });
    await step('Строим Сибую…', () => {
      this.city.build();
      this.scene.add(this.city.group);
    });
    await step('Расставляем фонари и сакуру…', () => {
      this.props.build();
      this.scene.add(this.props.group);
    });
    await step('Вешаем стенды с мемами…', () => {
      this.billboards.build(this.city.facadeSlots);
      this.scene.add(this.billboards.group);
      void this.billboards.loadManifest();
    });
    await step('Клеим плакаты…', () => {
      this.posters.build();
      this.scene.add(this.posters.group);
      void this.posters.loadManifest();
    });
    await step('Смотровая, мастерская, база Ваисова…', () => {
      this.zones.build();
      this.scene.add(this.zones.group);
      this.scene.add(this.sakura.points);
    });
    this.setDayness(this.dayness);
  }

  get fog(): THREE.Fog {
    return this.sky.fog;
  }

  /** Всё, что нужно физике машины о точке под ней. */
  /**
   * Высота и свойства покрытия под точкой.
   *
   * Порядок такой, чтобы нигде не было ступенек и провалов:
   *  1. асфальт + обочина — ровно высота дороги;
   *  2. тротуар в городе — на 16 см выше;
   *  3. дальше — плавный переход к рельефу в полосе шириной blend;
   *  4. под мостом и вообще везде — не ниже самого рельефа (в землю не проваливаемся).
   */
  queryGround(x: number, z: number): GroundQuery {
    const near = this.track.nearest(x, z);
    const hw = this.track.halfWidth;
    const sector = near.sample.sector;
    const rails = sector === 'touge' || sector === 'bridge' || near.sample.bridge;
    const urban = sector === 'city' || sector === 'industrial' || sector === 'docks';

    // Рельеф под точкой — нижняя граница для всего, кроме моста.
    let terrainY = this.terrain.heightAt(x, z);
    if (terrainY < WORLD.waterLevel) terrainY = WORLD.waterLevel;

    const asphalt = hw + 0.9; // проезжая часть с обочиной
    const sidewalk = asphalt + 2.6; // тротуар в городе
    const blend = 4; // полоса плавного схода к рельефу
    const d = near.dist;

    let y: number;
    if (d <= asphalt) {
      y = near.y;
    } else if (urban && d <= sidewalk) {
      y = near.y + 0.16;
    } else {
      const edge = urban ? sidewalk : asphalt;
      const edgeY = urban ? near.y + 0.16 : near.y;
      const t = smoothstep(edge, edge + blend, d);
      y = lerp(edgeY, terrainY, t);
    }

    // Мост висит над заливом: там рельеф ниже, прижимать к нему нельзя.
    const onBridgeDeck = near.sample.bridge && d <= asphalt + 2.5;
    if (!onBridgeDeck) y = Math.max(y, terrainY);

    return {
      y,
      onRoad: d <= hw + ROAD.onRoadMargin,
      lateral: near.lateral,
      halfWidth: hw,
      rails,
      nx: near.sample.nx,
      nz: near.sample.nz,
    };
  }

  groundHeight(x: number, z: number): number {
    return this.queryGround(x, z).y;
  }

  locationAt(x: number, z: number): LocationInfo {
    return LOCATIONS[this.track.nearest(x, z).sample.sector];
  }

  setDayness(t: number): void {
    this.dayness = t;
    this.sky.setDayness(t);
    this.city.setDayness(t);
    this.props.setDayness(t);
    this.billboards.setDayness(t);
    this.posters.setDayness(t);
    this.zones.setDayness(t);
  }

  update(dt: number, focus: THREE.Vector3, cameraPos: THREE.Vector3, questDone: boolean): void {
    this.time += dt;
    this.sky.update(dt, cameraPos);
    this.city.update(this.time);
    this.props.update(dt, focus);
    this.zones.update(dt, focus, questDone);
    this.sakura.update(dt, focus, this.sky.fog);
  }
}
