import type { Bike, RunStats } from '../domain/types';
import { World, distanceAtTime, speedAtTime } from './world';
import {
  ROAD_EVENTS,
  TRAFFIC_ENVIRONMENTS,
  isRoadEvent,
  roadResponse,
  type RoadEventKind,
} from './roadEvents';
import {
  BALANCE,
  advanceBalance,
  balanceAccuracy,
  wheelieScoreFactor,
} from './wheelie';
export const LANE = 2.8;
export const STEP = 1 / 60;
export type ObstacleKind = 'car' | 'van' | RoadEventKind;
export interface Obstacle {
  active: boolean;
  kind: ObstacleKind;
  lane: number;
  offsetX: number;
  z: number;
  passed: boolean;
  closest: number;
  color: number;
  cleared: boolean;
  rewardPoints: number;
  rewardText: string;
}
export interface GameEvent {
  text: string;
  kind: 'skill' | 'warning' | 'crash';
  serial: number;
}
export class Engine {
  phase: 'ready' | 'playing' | 'paused' | 'crashed' = 'ready';
  elapsed = 0;
  distance = 0;
  score = 0;
  speed = 22;
  lane = 0;
  x = 0;
  height = 0;
  velocityY = 0;
  airLaneChangeUsed = false;
  landingSerial = 0;
  landingSpeed = 0;
  roadRoughness = 0;
  surfaceGrip = 1;
  wheelie = false;
  wheelieHeld = false;
  forwardHeld = false;
  touchWeight = 0;
  wheelieAngle = 0;
  wheelieAngularVelocity = 0;
  throttleLoad = 0;
  forwardLoad = 0;
  liftPull = 0;
  liftArmed = true;
  balanceQuality = 0;
  balancedSeconds = 0;
  wheelieMeters = 0;
  combo = 1;
  bestCombo = 1;
  comboTime = 0;
  nearMisses = 0;
  jumps = 0;
  maxSpeed = 22;
  event: GameEvent = { text: '', kind: 'skill', serial: 0 };
  obstacles: Obstacle[] = Array.from({ length: 32 }, () => ({
    active: false,
    kind: 'car',
    lane: 0,
    offsetX: 0,
    z: 0,
    passed: false,
    closest: Infinity,
    color: 0,
    cleared: false,
    rewardPoints: 0,
    rewardText: '',
  }));
  readonly world: World;
  private rng: number;
  private spawnIn = 40;
  private nextSafe = 0;
  private wheelieChain = 0;
  private accumulator = 0;
  private id: string;
  constructor(
    public bike: Bike,
    seed = 5489,
  ) {
    this.rng = seed >>> 0;
    this.world = new World(seed, bike);
    this.id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${seed}`;
  }
  random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  start() {
    this.phase = 'playing';
  }
  move(direction: number) {
    if (this.phase !== 'playing') return;
    const airborne = this.height > 0 || this.velocityY !== 0;
    const next = Math.max(-1, Math.min(1, this.lane + direction));
    if (next === this.lane || (airborne && this.airLaneChangeUsed)) return;
    this.lane = next;
    if (airborne) this.airLaneChangeUsed = true;
  }
  get balanceProfile() {
    return BALANCE[this.bike.id] ?? BALANCE['450'];
  }
  get environment() {
    return this.world.at(this.distance)!;
  }
  hold(value: boolean) {
    this.wheelieHeld = value && this.phase === 'playing';
  }
  forward(value: boolean) {
    this.forwardHeld = value && this.phase === 'playing';
  }
  weight(value: number) {
    this.touchWeight =
      this.phase === 'playing' && Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0;
  }
  get throttleInput() {
    return Math.max(this.wheelieHeld ? 1 : 0, this.touchWeight);
  }
  get forwardInput() {
    return Math.max(this.forwardHeld ? 1 : 0, -this.touchWeight);
  }
  pause() {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.clearInput();
    }
  }
  resume() {
    if (this.phase === 'paused') this.phase = 'playing';
  }
  clearInput() {
    this.wheelieHeld = false;
    this.forwardHeld = false;
    this.touchWeight = 0;
  }
  skill(text: string, points: number) {
    this.combo = Math.min(5, this.combo + 0.5);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTime = 3.8;
    this.score += points * this.combo;
    this.event = { text, kind: 'skill', serial: this.event.serial + 1 };
  }
  crash(cause = 'Traffic collision') {
    if (this.phase !== 'playing') return;
    this.phase = 'crashed';
    this.clearInput();
    this.event = { text: cause, kind: 'crash', serial: this.event.serial + 1 };
  }
  advance(dt: number) {
    if (this.phase !== 'playing') return;
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= STEP && this.phase === 'playing') {
      this.tick(STEP);
      this.accumulator -= STEP;
    }
  }
  private spawnWave() {
    const change = this.random() < 0.7 ? (this.random() < 0.5 ? -1 : 1) : 0;
    this.nextSafe = Math.max(-1, Math.min(1, this.nextSafe + change));
    const section = this.world.at(this.distance + 145)!.kind;
    const environment = TRAFFIC_ENVIRONMENTS[section];
    this.spawnIn = Math.max(
      environment.minimumSpacing,
      environment.initialSpacing - this.elapsed * 0.22,
    );
    // One offset vehicle leaves the center as an optional near pass and the
    // opposite outer lane completely clear. Never make the narrow route mandatory.
    if (this.elapsed > 20 && this.random() < 0.12) {
      const side =
        this.nextSafe === 0 ? (this.random() < 0.5 ? -1 : 1) : -this.nextSafe;
      this.spawn('car', side, 145, -side * 1.12);
      return;
    }
    const candidates = [-1, 0, 1].filter((l) => l !== this.nextSafe);
    const count =
      this.elapsed > 20 && this.random() < environment.doubleChance ? 2 : 1;
    if (this.random() < 0.5) candidates.reverse();
    for (let i = 0; i < count; i++) {
      const kind =
        environment.kinds[Math.floor(this.random() * environment.kinds.length)];
      this.spawn(kind, candidates[i], 145);
    }
  }
  spawn(kind: ObstacleKind, lane: number, z: number, offsetX = 0) {
    const o = this.obstacles.find((x) => !x.active);
    if (o)
      Object.assign(o, {
        active: true,
        kind,
        lane,
        offsetX,
        z,
        passed: false,
        closest: Infinity,
        color: Math.floor(this.random() * 4),
        cleared: false,
        rewardPoints: 0,
        rewardText: '',
      });
    return o;
  }
  private tick(dt: number) {
    const previousElapsed = this.elapsed;
    this.elapsed += dt;
    this.speed = speedAtTime(this.elapsed, this.bike);
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    const travel =
      distanceAtTime(this.elapsed, this.bike) -
      distanceAtTime(previousElapsed, this.bike);
    this.distance += travel;
    this.world.advance(this.distance);
    this.roadRoughness *= Math.exp(-dt * 7);
    this.surfaceGrip += (1 - this.surfaceGrip) * (1 - Math.exp(-dt * 1.8));
    this.score += travel * (1 + this.speed / 60) * this.combo;
    this.x +=
      (this.lane * LANE - this.x) *
      Math.min(
        1,
        dt * this.bike.handling * this.surfaceGrip * (this.wheelie ? 0.78 : 1),
      );
    if (this.height > 0 || this.velocityY > 0) {
      this.velocityY -= 21 * dt;
      this.height += this.velocityY * dt;
      if (this.height <= 0) {
        this.landingSpeed = Math.abs(this.velocityY);
        this.landingSerial++;
        this.height = 0;
        this.velocityY = 0;
        this.airLaneChangeUsed = false;
      }
    }
    const touchdown = advanceBalance(
      this,
      this.balanceProfile,
      this.speed,
      this.height === 0 ? this.throttleInput : 0,
      this.forwardInput,
      dt,
    );
    if (touchdown > 0.4) {
      this.landingSerial++;
      this.landingSpeed = touchdown * 2;
    }
    if (this.wheelieAngle >= this.balanceProfile.crashAngle) {
      this.crash('Overrotated the wheelie');
      return;
    }
    this.wheelie = this.wheelieAngle > 0.12 && this.height === 0;
    this.balanceQuality = this.wheelie
      ? balanceAccuracy(this, this.balanceProfile)
      : 0;
    if (this.wheelie) {
      this.wheelieMeters += travel;
      this.balancedSeconds += dt * this.balanceQuality;
      this.wheelieChain += travel * this.balanceQuality;
      const durationBonus = 1 + Math.min(1, this.balancedSeconds / 6);
      this.score +=
        travel *
        4 *
        wheelieScoreFactor(this, this.balanceProfile) *
        durationBonus *
        (this.speed / 22) *
        this.combo;
      if (this.wheelieChain >= 20) {
        this.wheelieChain -= 20;
        this.skill('BALANCED', 45);
      }
    } else {
      this.wheelieChain = 0;
      this.balancedSeconds = 0;
    }
    this.comboTime -= dt;
    if (this.comboTime <= 0) this.combo = 1;
    this.spawnIn -= travel;
    for (const o of this.obstacles) {
      if (!o.active) continue;
      const prev = o.z;
      o.z -= travel;
      const dx = Math.abs(this.x - (o.lane * LANE + o.offsetX));
      const road = isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind] : undefined;
      const length = road?.contactHalfLength ?? (o.kind === 'van' ? 3.3 : 3);
      {
        const overlap = o.z < length && prev > -length;
        const top = road?.height ?? (o.kind === 'van' ? 2.55 : 2.05);
        if (overlap && this.height < top) {
          const gap = dx - (road?.contactHalfWidth ?? 1.16);
          if (gap < 0) {
            if (isRoadEvent(o.kind)) {
              if (!o.cleared) {
                const response = roadResponse(
                  o.kind,
                  this.bike.id,
                  this.wheelieAngle,
                  this.forwardLoad,
                );
                if (response.crash) {
                  this.crash(response.crash);
                  break;
                }
                o.cleared = true;
                o.rewardPoints = response.rewardPoints;
                o.rewardText = response.rewardText;
                this.roadRoughness = Math.max(
                  this.roadRoughness,
                  response.roughness,
                );
                this.surfaceGrip = Math.min(this.surfaceGrip, response.grip);
              }
            } else {
              this.crash('Traffic collision');
              break;
            }
          }
          if (gap >= 0) o.closest = Math.min(o.closest, gap);
        }
        if (!o.passed && o.z < -length) {
          o.passed = true;
          if (o.cleared && o.rewardPoints > 0)
            this.skill(o.rewardText, o.rewardPoints);
          else if ((!road || o.kind === 'barrier') && o.closest < 0.6) {
            this.nearMisses++;
            this.skill('NEAR MISS', 150);
          }
        }
      }
      if (o.z < -18) o.active = false;
    }
    // Spawn after existing objects move so distance + z is the precise segment
    // used for both the upcoming environment and the newly rendered road event.
    if (this.phase === 'playing' && this.spawnIn <= 0) this.spawnWave();
  }
  stats(): RunStats {
    return {
      id: this.id,
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      seconds: Math.floor(this.elapsed),
      bestCombo: this.bestCombo,
      nearMisses: this.nearMisses,
      jumps: this.jumps,
      wheelieMeters: Math.floor(this.wheelieMeters),
      maxSpeed: Math.round(this.maxSpeed * 3.6),
      cause: this.event.kind === 'crash' ? this.event.text : 'Ride ended',
    };
  }
}
