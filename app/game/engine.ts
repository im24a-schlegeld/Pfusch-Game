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
  tailScrape,
} from './wheelie';
import {
  TRAFFIC_SHAPES,
  TOW_RAMP,
  distanceDifficulty,
  towRampHeight,
  towRampLaunchHeight,
  type TrafficKind,
} from './trafficDomain';
import { SIGN_IDS, type SignId } from './signCollectibles';
export const LANE = 2.8;
export const STEP = 1 / 60;
export type ObstacleKind = TrafficKind | RoadEventKind;
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
  velocity: number;
  rampUsed: boolean;
}
export interface GameEvent {
  text: string;
  kind: 'skill' | 'warning' | 'crash';
  serial: number;
}
export interface SignPickup {
  active: boolean;
  id: SignId;
  lane: number;
  z: number;
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
  launchSerial = 0;
  wheelieLaunchSerial = 0;
  towJumpActive = false;
  laneChangeSerial = 0;
  laneChangeDirection = 0;
  laneChangeAge = 1;
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
  scrapeMaterial: 'metal' | 'plastic' | null = null;
  scrapeIntensity = 0;
  balancedSeconds = 0;
  wheelieMeters = 0;
  combo = 1;
  bestCombo = 1;
  comboTime = 0;
  nearMisses = 0;
  jumps = 0;
  collectedSigns = 0;
  signSetCount = 0;
  signPickupSerial = 0;
  lastSignId: SignId | null = null;
  signs: SignPickup[] = Array.from({ length: 8 }, () => ({
    active: false,
    id: 'P',
    lane: 0,
    z: 0,
  }));
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
    velocity: 0,
    rampUsed: false,
  }));
  readonly world: World;
  private rng: number;
  private spawnIn = 40;
  private nextSafe = 0;
  private wheelieChain = 0;
  private accumulator = 0;
  private rampApproach = 0;
  private scrapeMeters = 0;
  private signSequence = 0;
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
    if (this.phase !== 'playing' || !Number.isFinite(direction)) return;
    const airborne = this.height > 0 || this.velocityY !== 0;
    const next = Math.max(-1, Math.min(1, this.lane + Math.sign(direction)));
    if (next === this.lane || (airborne && this.airLaneChangeUsed)) return;
    this.laneChangeDirection = next - this.lane;
    this.laneChangeAge = 0;
    this.laneChangeSerial++;
    this.lane = next;
    if (airborne) this.airLaneChangeUsed = true;
    else this.rampApproach = 0.6;
  }
  get balanceProfile() {
    return BALANCE[this.bike.id] ?? BALANCE['450'];
  }
  get environment() {
    return this.world.at(this.distance)!;
  }
  get difficulty() {
    return distanceDifficulty(this.distance);
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
    this.scrapeIntensity = 0;
    this.scrapeMaterial = null;
    this.towJumpActive = false;
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
    const section = this.world.at(this.distance + 145)!.kind;
    const environment = TRAFFIC_ENVIRONMENTS[section];
    const moving =
      !environment.kinds.includes('construction') &&
      this.distance > 350 &&
      this.random() < 0.22 + this.difficulty * 0.2;
    const velocity = moving ? 6 + this.random() * 3 : 0;
    const arrival = this.arrivalTime(145, velocity);
    // A slower moving wave must not be overtaken by a following parked wave.
    // Keep wave arrival order, with time for the adjacent guaranteed safe lane.
    if (
      this.obstacles.some(
        (o) =>
          o.active &&
          o.z > 0 &&
          arrival - this.arrivalTime(o.z, o.velocity) < 1.65,
      )
    ) {
      this.spawnIn = 12;
      return;
    }
    const change = this.random() < 0.7 ? (this.random() < 0.5 ? -1 : 1) : 0;
    this.nextSafe = Math.max(-1, Math.min(1, this.nextSafe + change));
    this.spawnIn =
      environment.initialSpacing +
      (environment.minimumSpacing - environment.initialSpacing) *
        this.difficulty;
    // One offset vehicle leaves the center as an optional near pass and the
    // opposite outer lane completely clear. Never make the narrow route mandatory.
    if (this.elapsed > 20 && this.random() < 0.12) {
      const side =
        this.nextSafe === 0 ? (this.random() < 0.5 ? -1 : 1) : -this.nextSafe;
      this.spawn('car', side, 145, -side * 0.86, velocity);
      this.spawnWaveSign();
      return;
    }
    const candidates = [-1, 0, 1].filter((l) => l !== this.nextSafe);
    const count =
      this.distance > 450 &&
      this.random() < 0.12 + (environment.doubleChance - 0.12) * this.difficulty
        ? 2
        : 1;
    if (this.random() < 0.5) candidates.reverse();
    for (let i = 0; i < count; i++) {
      let kind =
        environment.kinds[Math.floor(this.random() * environment.kinds.length)];
      if (kind === 'towtruck' && this.distance < 500) kind = 'car';
      // Construction is stationary; a mixed wave stays stationary together.
      this.spawn(kind, candidates[i], 145, 0, velocity);
    }
    this.spawnWaveSign();
  }
  private spawnWaveSign() {
    if (this.random() > 0.42) return;
    // Signs stand in the world. A moving vehicle may arrive later than its sign,
    // so also check all preceding traffic at the actual pickup arrival time.
    const arrival = this.arrivalTime(128, 0);
    const lane = [this.nextSafe, 0, -1, 1].find((candidate) =>
      this.obstacles.every((obstacle) => {
        if (!obstacle.active || isRoadEvent(obstacle.kind)) return true;
        const shape = TRAFFIC_SHAPES[obstacle.kind];
        const atPickup = obstacle.z - 128 + obstacle.velocity * arrival;
        return (
          Math.abs(atPickup) > shape.contactHalfLength + 5 ||
          Math.abs(
            candidate * LANE - (obstacle.lane * LANE + obstacle.offsetX),
          ) >
            shape.contactHalfWidth + 0.1
        );
      }),
    );
    if (lane === undefined) return;
    // Ordered symbols guarantee that completing a set never depends on rare RNG.
    if (
      this.spawnSign(SIGN_IDS[this.signSequence % SIGN_IDS.length], lane, 128)
    )
      this.signSequence++;
  }
  spawnSign(id: SignId, lane: number, z: number) {
    if (!SIGN_IDS.includes(id) || !Number.isFinite(lane) || !Number.isFinite(z))
      return;
    const sign = this.signs.find((entry) => !entry.active);
    if (sign)
      Object.assign(sign, {
        active: true,
        id,
        lane: Math.max(-1, Math.min(1, Math.round(lane))),
        z,
      });
    return sign;
  }
  private arrivalTime(z: number, velocity: number) {
    const speed = Math.max(0.1, this.speed - velocity);
    const acceleration = this.bike.acceleration;
    const untilCap =
      acceleration > 0
        ? Math.max(0, (this.bike.maxSpeed - this.speed) / acceleration)
        : 0;
    const capDistance = speed * untilCap + 0.5 * acceleration * untilCap ** 2;
    if (acceleration > 0 && z < capDistance)
      return (
        (2 * z) / (speed + Math.sqrt(speed * speed + 2 * acceleration * z))
      );
    return (
      untilCap +
      (z - capDistance) / Math.max(0.1, this.bike.maxSpeed - velocity)
    );
  }
  spawn(
    kind: ObstacleKind,
    lane: number,
    z: number,
    offsetX = 0,
    velocity = 0,
  ) {
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
        velocity:
          kind === 'construction' || isRoadEvent(kind)
            ? 0
            : Math.max(
                0,
                Math.min(12, Number.isFinite(velocity) ? velocity : 0),
              ),
        rampUsed: false,
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
    // Travel is only a small participation score; technique supplies the points.
    this.score += travel * 0.12;
    const previousX = this.x;
    this.laneChangeAge = Math.min(1, this.laneChangeAge + dt);
    const steeringLead =
      this.height > 0 || this.wheelie
        ? 1
        : Math.max(0, Math.min(1, (this.laneChangeAge - 0.055) / 0.06));
    this.x +=
      (this.lane * LANE - this.x) *
      Math.min(
        1,
        dt *
          this.bike.handling *
          this.surfaceGrip *
          (this.wheelie ? 0.78 : 1) *
          steeringLead,
      );
    if (this.rampApproach > 0 && this.height === 0 && this.wheelieAngle < 0.3) {
      const ramp = this.obstacles.find((o) => {
        if (
          !o.active ||
          o.kind !== 'towtruck' ||
          o.rampUsed ||
          o.lane !== this.lane
        )
          return false;
        const center = o.lane * LANE + o.offsetX;
        const entryWidth = TRAFFIC_SHAPES.towtruck.contactHalfWidth;
        return (
          o.z >= TOW_RAMP.frontZ + 0.2 &&
          o.z <= TOW_RAMP.rearZ &&
          Math.abs(previousX - center) > entryWidth &&
          Math.abs(this.x - center) <= entryWidth
        );
      });
      if (ramp) {
        ramp.rampUsed = true;
        this.height = towRampLaunchHeight(
          this.bike.id,
          ramp.z - (travel - ramp.velocity * dt),
          this.speed - ramp.velocity,
        );
        this.velocityY = TOW_RAMP.launchVelocity;
        this.airLaneChangeUsed = false;
        this.towJumpActive = true;
        this.launchSerial++;
        this.rampApproach = 0;
        this.event = {
          text: 'RAMP TRANSFER',
          kind: 'skill',
          serial: this.event.serial + 1,
        };
      }
    }
    this.rampApproach = Math.max(0, this.rampApproach - dt);
    let landedTowJump = false;
    if (this.height > 0 || this.velocityY > 0) {
      this.velocityY -= TOW_RAMP.gravity * dt;
      this.height += this.velocityY * dt;
      if (this.height <= 0) {
        this.landingSpeed = Math.abs(this.velocityY);
        this.landingSerial++;
        this.height = 0;
        this.velocityY = 0;
        this.airLaneChangeUsed = false;
        if (this.towJumpActive) {
          this.towJumpActive = false;
          landedTowJump = true;
        }
      }
    }
    const wasArmed = this.liftArmed;
    const touchdown = advanceBalance(
      this,
      this.balanceProfile,
      this.speed,
      this.height === 0 ? this.throttleInput : 0,
      this.forwardInput,
      dt,
    );
    if (wasArmed && !this.liftArmed) this.wheelieLaunchSerial++;
    if (touchdown > 0.4) {
      this.landingSerial++;
      this.landingSpeed = touchdown * 2;
    }
    if (this.wheelieAngle >= this.balanceProfile.crashAngle) {
      this.crash('Overrotated the wheelie');
      return;
    }
    this.wheelie = this.wheelieAngle > 0.12 && this.height === 0;
    const scrape = tailScrape(
      this.bike.id,
      this.wheelieAngle,
      this.balanceProfile,
    );
    this.scrapeIntensity = this.wheelie ? scrape.intensity : 0;
    this.scrapeMaterial = this.scrapeIntensity > 0 ? scrape.material : null;
    if (this.scrapeIntensity > 0) {
      this.scrapeMeters += travel;
      this.score += travel * 5 * this.scrapeIntensity * this.combo;
      if (this.scrapeMeters >= 7) {
        this.scrapeMeters = 0;
        this.skill('TAIL SCRAPE', 100);
      }
    } else this.scrapeMeters = 0;
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
        6 *
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
      o.z -= travel - o.velocity * dt;
      const dx = Math.abs(this.x - (o.lane * LANE + o.offsetX));
      const road = isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind] : undefined;
      const traffic = !isRoadEvent(o.kind) ? TRAFFIC_SHAPES[o.kind] : undefined;
      const length = road?.contactHalfLength ?? traffic!.contactHalfLength;
      {
        const overlap = o.z < length && prev > -length;
        const top =
          o.kind === 'towtruck' && o.z > TOW_RAMP.cabRearZ
            ? o.z > TOW_RAMP.frontZ
              ? towRampHeight(o.z)
              : TOW_RAMP.frontHeight
            : (road?.height ?? traffic!.height);
        if (overlap && this.height < top) {
          const gap =
            dx - (road?.contactHalfWidth ?? traffic!.contactHalfWidth);
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
              this.crash(
                o.kind === 'construction'
                  ? 'Construction barrier collision'
                  : 'Traffic collision',
              );
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
    if (landedTowJump && this.phase === 'playing') {
      this.jumps++;
      this.skill('TOW TRUCK TRANSFER', 350);
    }
    if (this.phase === 'playing')
      for (const sign of this.signs) {
        if (!sign.active) continue;
        const before = sign.z;
        sign.z -= travel;
        if (
          sign.z < 1.2 &&
          before > -1.2 &&
          Math.abs(this.x - sign.lane * LANE) < 0.9 &&
          this.height < 2.1
        ) {
          sign.active = false;
          this.lastSignId = sign.id;
          this.signPickupSerial++;
          this.collectedSigns |= 1 << SIGN_IDS.indexOf(sign.id);
          if (this.collectedSigns === (1 << SIGN_IDS.length) - 1) {
            this.signSetCount++;
            this.collectedSigns = 0;
            this.skill('PFUSCH SET COMPLETE', 750);
          } else this.skill(`SIGN · ${sign.id}`, 45);
        } else if (sign.z < -12) sign.active = false;
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
