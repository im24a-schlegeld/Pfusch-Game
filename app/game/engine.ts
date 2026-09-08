import type { Bike, RunStats } from '../domain/types';
export const LANE = 2.8;
export const STEP = 1 / 60;
export type ObstacleKind = 'car' | 'van' | 'barrier' | 'ramp';
export interface Obstacle {
  active: boolean;
  kind: ObstacleKind;
  lane: number;
  z: number;
  passed: boolean;
  closest: number;
  color: number;
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
  wheelie = false;
  wheelieHeld = false;
  wheelieHeat = 0;
  wheelieLock = 0;
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
    z: 0,
    passed: false,
    closest: Infinity,
    color: 0,
  }));
  private rng: number;
  private spawnIn = 40;
  private nextSafe = 0;
  private wheelieChain = 0;
  private jumpRewarded = false;
  private accumulator = 0;
  private id: string;
  constructor(
    public bike: Bike,
    seed = 5489,
  ) {
    this.rng = seed >>> 0;
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
    if (this.phase === 'playing')
      this.lane = Math.max(-1, Math.min(1, this.lane + direction));
  }
  jump(ramp = false) {
    if (this.phase !== 'playing' || this.height > 0.05) return;
    this.velocityY = ramp ? 10.5 : 8.4;
    this.height = 0.01;
    this.wheelie = false;
    this.jumps++;
    this.jumpRewarded = false;
    if (ramp) this.skill('RAMP SEND', 100);
  }
  hold(value: boolean) {
    this.wheelieHeld = value;
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
    this.wheelie = false;
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
    const candidates = [-1, 0, 1].filter((l) => l !== this.nextSafe);
    const count = this.elapsed > 20 && this.random() < 0.55 ? 2 : 1;
    if (this.random() < 0.5) candidates.reverse();
    for (let i = 0; i < count; i++) {
      const roll = this.random();
      const kind: ObstacleKind =
        roll < 0.52 ? 'car' : roll < 0.75 ? 'van' : 'barrier';
      this.spawn(kind, candidates[i], 145);
    }
    if (count === 1 && this.random() < 0.24)
      this.spawn('ramp', candidates[1], 145);
    this.spawnIn = Math.max(54, 78 - this.elapsed * 0.22);
  }
  spawn(kind: ObstacleKind, lane: number, z: number) {
    const o = this.obstacles.find((x) => !x.active);
    if (o)
      Object.assign(o, {
        active: true,
        kind,
        lane,
        z,
        passed: false,
        closest: Infinity,
        color: Math.floor(this.random() * 4),
      });
    return o;
  }
  private tick(dt: number) {
    this.elapsed += dt;
    this.speed = Math.min(
      this.bike.maxSpeed,
      22 + this.elapsed * this.bike.acceleration,
    );
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    const travel = this.speed * dt;
    this.distance += travel;
    this.score += travel * (1 + this.speed / 60) * this.combo;
    this.x +=
      (this.lane * LANE - this.x) *
      Math.min(1, dt * this.bike.handling * (this.wheelie ? 0.78 : 1));
    if (this.height > 0 || this.velocityY > 0) {
      this.velocityY -= 21 * dt;
      this.height += this.velocityY * dt;
      if (this.height <= 0) {
        this.height = 0;
        this.velocityY = 0;
      }
    }
    this.wheelieLock = Math.max(0, this.wheelieLock - dt);
    this.wheelie =
      this.wheelieHeld && this.height === 0 && this.wheelieLock === 0;
    if (this.wheelie) {
      this.wheelieMeters += travel;
      this.wheelieChain += travel;
      this.score += travel * 1.8 * this.combo;
      this.wheelieHeat += dt / (4.5 * this.bike.stability);
      if (this.wheelieChain >= 28) {
        this.wheelieChain -= 28;
        this.skill('ONE WHEEL', 35);
      }
      if (this.wheelieHeat >= 1) {
        this.wheelie = false;
        this.wheelieLock = 1.3;
        this.wheelieHeat = 0.6;
        this.combo = 1;
        this.event = {
          text: 'SETTLE IT · RELEASE WHEELIE',
          kind: 'warning',
          serial: this.event.serial + 1,
        };
      }
    } else {
      this.wheelieHeat = Math.max(0, this.wheelieHeat - dt * 0.65);
      this.wheelieChain = 0;
    }
    this.comboTime -= dt;
    if (this.comboTime <= 0) this.combo = 1;
    this.spawnIn -= travel;
    if (this.spawnIn <= 0) this.spawnWave();
    for (const o of this.obstacles) {
      if (!o.active) continue;
      const prev = o.z;
      o.z -= travel;
      const dx = Math.abs(this.x - o.lane * LANE);
      const length = o.kind === 'van' ? 3.3 : o.kind === 'car' ? 3 : 1.6;
      if (o.kind === 'ramp') {
        if (prev >= 0 && o.z <= 0 && dx < 0.95) this.jump(true);
      } else {
        const overlap = o.z < length && prev > -length;
        const top =
          o.kind === 'barrier' ? 0.78 : o.kind === 'van' ? 2.55 : 2.05;
        if (overlap && this.height < top) {
          const gap = dx - (o.kind === 'barrier' ? 1.12 : 1.16);
          if (gap < 0) {
            this.crash(
              o.kind === 'barrier' ? 'Clipped a barrier' : 'Traffic collision',
            );
            break;
          }
          o.closest = Math.min(o.closest, gap);
        }
        if (!o.passed && o.z < -length) {
          o.passed = true;
          if (o.closest < 0.6) {
            this.nearMisses++;
            this.skill('NEAR MISS', 150);
          } else if (dx < 1.1 && this.height > 0.6 && !this.jumpRewarded) {
            this.jumpRewarded = true;
            this.skill('CLEAN CLEAR', 90);
          }
        }
      }
      if (o.z < -18) o.active = false;
    }
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
