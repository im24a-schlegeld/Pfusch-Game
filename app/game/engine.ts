import { TOW_TRANSFER, transferX } from './towTransfer';
import { CONSTRUCTION_RAMP, constructionRampPose } from './constructionRamp';
import { carContactPitch, carFrontReach, carJumpClearance, carRearReach } from './carClearance';
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
  towRampPose,
  towDeckPosition,
  RAMP_FRONT_CONTACT,
  trafficFrontReach,
  type TrafficKind,
} from './trafficDomain';
import { SIGN_IDS, type SignId } from './signCollectibles';
import {
  COMPLETE_SIGN_MASK,
  nextMissingSign,
  signBit,
  signScoreReady,
  SIGN_RETRY_DISTANCE,
  SIGN_DISTANCE_GAP,
} from './signSet';
import { rampEntryImpulse, consumeRampImpulse } from './rampEntry';
import {
  TRAFFIC_FLOW,
  trafficArrivalGap,
  trafficSeparatedUntilPass,
  trafficWaveSpacing,
} from './trafficFlow';
import { SPEED_CAMERA, SpeedCameraSchedule } from './speedCamera';
import {
  POLICE,
  createPoliceVehicle,
  firstPoliceHit,
  policeImpactOffset,
  policeRampPose,
  policeTargetShape,
  type PoliceImpactEvent,
} from './policePursuit';
export const LANE = 2.8;
export const STEP = 1 / 60;
export const CLOSE_CALL = Object.freeze({ gap: 0.25, evadeSeconds: 0.35 });
export type EngineInput =
  | { type: 'hold' | 'forward'; value: boolean }
  | { type: 'weight'; value: number }
  | { type: 'move'; value: -1 | 1 }
  | { type: 'clear' | 'end' };
export type ObstacleKind = TrafficKind | RoadEventKind;
export interface Obstacle {
  spawnId: number;
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
  airNearMiss: boolean;
  lateEvade: boolean;
  police: boolean;
}
export interface GameEvent {
  text: string;
  kind: 'skill' | 'warning' | 'crash';
  serial: number;
}
export interface ScoreGain {
  serial: number;
  text: string;
  points: number;
  updatedAt: number;
  group?: 'ride' | 'wheelie' | 'scrape';
}
export const STUNT_POINTS = Object.freeze({
  jump: 350,
  carJump: 700,
  nearMiss: 150,
  airEvade: 240,
  wheelieLaneSwitch: 5,
  policeEscape: 500,
});
export interface SignPickup {
  active: boolean;
  id: SignId;
  lane: number;
  z: number;
}
export class Engine {
  /** Active fixed steps only; paused/countdown wall time never advances this clock. */
  fixedTicks = 0;
  onInput?: (input: EngineInput, tick: number) => void;
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
  constructionJumpActive = false;
  towPitch = 0;
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
  policeChase = false;
  policeProgress = 0;
  /** Actual remaining chase time; traffic obstruction pauses the deadline. */
  policeRamRemaining = 0;
  policeOutcome: 'none' | 'escaped' | 'caught' = 'none';
  policeOutcomeSerial = 0;
  policeImpactTarget: Obstacle | null = null;
  readonly policeVehicle = createPoliceVehicle();
  readonly policeImpact: PoliceImpactEvent = {
    serial: 0,
    targetSpawnId: 0,
    x: 0,
    z: 0,
    worldDistance: 0,
    fallback: false,
  };
  policeRamObstacle: Obstacle | null = null;
  private readonly cameraSchedule = new SpeedCameraSchedule();
  get speedCamera() {
    return this.cameraSchedule.camera;
  }
  blitzerFlashSerial = 0;
  blitzerFlashRemaining = 0;
  balancedSeconds = 0;
  wheelieMeters = 0;
  nearMisses = 0;
  jumps = 0;
  scoreGains: ScoreGain[] = [];
  collectedSigns = 0;
  signSetCount = 0;
  signPickupSerial = 0;
  lastSignId: SignId | null = null;
  private readonly signPickupHistory = Array.from({ length: 8 }, () => ({ serial: 0, id: 'P' as SignId }));
  signs: SignPickup[] = Array.from({ length: 8 }, () => ({
    active: false,
    id: 'P',
    lane: 0,
    z: 0,
  }));
  maxSpeed = 22;
  event: GameEvent = { text: '', kind: 'skill', serial: 0 };
  /** Obstacle responsible for the current crash, for collision-aware visuals. */
  crashObstacle: Obstacle | null = null;
  obstacles: Obstacle[] = Array.from({ length: 32 }, () => ({
    spawnId: 0,
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
    airNearMiss: false,
    lateEvade: false,
    police: false,
  }));
  readonly world: World;
  private rng: number;
  private spawnIn = 24;
  private spawnSerial = 0;
  private nextPatrolDistance = 900;
  private policeReadyAt = 0;
  private nextSafe = 0;
  private safeDirection = 1;
  private pendingWave: {
    section: string;
    kinds: ObstacleKind[];
    velocity: number;
  } | null = null;
  private scoreGainSerial = 0;
  private accumulator = 0;
  private towCarrier: Obstacle | null = null;
  private towSafeObstacles = new Set<Obstacle>();
  private towTransferCars = new Set<Obstacle>();
  private signSequence = 0;
  private nextSignAttempt = 300;
  private rampEntryRemaining = 0;
  private transferAge = 0;
  private transferOriginX = 0;
  resumeRemaining = 0;
  private towWarningFor: Obstacle | null = null;
  private policeTargetId = 0;
  private policeImpactEndZ = 0;
  private policeImpactReported = false;
  private readonly policeTargetLast = {
    x: 0,
    worldDistance: 0,
    velocity: 0,
    elapsed: 0,
  };
  private policeJumpTarget: { obstacle: Obstacle; spawnId: number } | null =
    null;
  private id: string;
  constructor(
    public bike: Bike,
    seed = 5489,
  ) {
    this.rng = seed >>> 0;
    // Short rides can start with different daily letters; the replay uses the
    // same seed and the traffic random stream consumes no additional draw.
    this.signSequence = this.rng % SIGN_IDS.length;
    this.world = new World(seed, bike);
    this.id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${seed}`;
  }
  random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  start() {
    if (this.phase === 'ready') this.phase = 'playing';
  }
  get onTowTruck() {
    return this.towCarrier !== null;
  }
  move(direction: number, scoreWheelieLaneSwitch = true) {
    if (this.phase !== 'playing' || !Number.isFinite(direction)) return;
    const airborne =
      !this.onTowTruck && (this.height > 0 || this.velocityY !== 0);
    const next = Math.max(-1, Math.min(1, this.lane + Math.sign(direction)));
    if (next === this.lane || (airborne && this.airLaneChangeUsed)) return;
    if (scoreWheelieLaneSwitch) this.onInput?.({ type: 'move', value: direction < 0 ? -1 : 1 }, this.fixedTicks);
    if (this.towCarrier && this.cabContact(this.towCarrier.z)) {
      this.crash('Missed the side jump', this.towCarrier);
      return;
    }
    if (!airborne && !this.towCarrier) {
      for (const obstacle of this.obstacles) {
        if (
          !obstacle.active ||
          obstacle.passed ||
          (isRoadEvent(obstacle.kind) && obstacle.kind !== 'barrier')
        )
          continue;
        const shape = isRoadEvent(obstacle.kind)
          ? ROAD_EVENTS[obstacle.kind]
          : TRAFFIC_SHAPES[obstacle.kind];
        const rear = isRoadEvent(obstacle.kind)
          ? shape.contactHalfLength
          : TRAFFIC_SHAPES[obstacle.kind].rearZ + 1;
        const time =
          (obstacle.z - rear) / Math.max(1, this.speed - obstacle.velocity);
        if (
          time > -0.05 &&
          time <= CLOSE_CALL.evadeSeconds &&
          Math.abs(this.x - (obstacle.lane * LANE + obstacle.offsetX)) <
            shape.contactHalfWidth
        )
          obstacle.lateEvade = true;
      }
    }
    this.laneChangeDirection = next - this.lane;
    this.laneChangeAge = 0;
    this.laneChangeSerial++;
    this.lane = next;
    if (scoreWheelieLaneSwitch && this.wheelie) {
      this.skill('WHEELIE LANE SWITCH', STUNT_POINTS.wheelieLaneSwitch);
    }
    if (this.towCarrier) {
      // The immediate ramp-lip swipe retains its original low ballistic arc.
      // Only a car paired alongside this carrier can receive side-contact
      // grace; approaching its rear bumper remains an ordinary collision.
      const carrier = this.towCarrier;
      this.towTransferCars.clear();
      for (const obstacle of this.obstacles) {
        if (obstacle.active && !obstacle.passed && obstacle.kind === 'car'
          && obstacle.lane === next
          && Math.abs(obstacle.z - carrier.z) <= TRAFFIC_SHAPES.car.length / 2
          && Math.abs(this.x - (obstacle.lane * LANE + obstacle.offsetX)) >= TRAFFIC_SHAPES.car.contactHalfWidth)
          this.towTransferCars.add(obstacle);
      }
      if (this.policeChase)
        this.policeJumpTarget = { obstacle: carrier, spawnId: carrier.spawnId };
      this.towSafeObstacles.add(carrier);
      this.towCarrier = null;
      this.velocityY = TOW_TRANSFER.launchVelocity;
      if (this.wheelieAngle < this.balanceProfile.balancePoint)
        this.wheelieAngularVelocity -= 0.58;
      this.transferAge = 0;
      this.transferOriginX = this.x;
      this.towJumpActive = true;
      this.airLaneChangeUsed = true;
      this.launchSerial++;
      this.event = {
        text: 'RAMP TRANSFER',
        kind: 'skill',
        serial: this.event.serial + 1,
      };
    } else if (airborne) this.airLaneChangeUsed = true;
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
    const held = value && this.phase === 'playing';
    if (held !== this.wheelieHeld) this.onInput?.({ type: 'hold', value: held }, this.fixedTicks);
    this.wheelieHeld = held;
  }
  forward(value: boolean) {
    const held = value && this.phase === 'playing';
    if (held !== this.forwardHeld) this.onInput?.({ type: 'forward', value: held }, this.fixedTicks);
    this.forwardHeld = held;
  }
  weight(value: number) {
    const weight =
      this.phase === 'playing' && Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0;
    if (weight !== this.touchWeight) this.onInput?.({ type: 'weight', value: weight }, this.fixedTicks);
    this.touchWeight = weight;
  }
  get throttleInput() {
    return Math.max(this.wheelieHeld ? 1 : 0, this.touchWeight);
  }
  get forwardInput() {
    return Math.max(this.forwardHeld ? 1 : 0, -this.touchWeight);
  }
  pause() {
    if (this.phase === 'playing' || this.phase === 'paused') {
      this.phase = 'paused';
      this.resumeRemaining = 0;
      this.accumulator = 0;
      this.clearInput();
    }
  }
  resume() {
    if (this.phase === 'paused' && this.resumeRemaining === 0) {
      this.clearInput();
      this.accumulator = 0;
      this.resumeRemaining = 3;
    }
  }
  /** A deliberate tutorial gesture continues immediately without a catch-up. */
  resumeTutorial() {
    if (this.phase !== 'paused') return;
    this.clearInput();
    this.accumulator = 0;
    this.resumeRemaining = 0;
    this.phase = 'playing';
  }
  /** Ending a paused run is explicit; it does not resume gameplay or a timer. */
  endRide() {
    if (this.phase === 'crashed') return;
    this.onInput?.({ type: 'end' }, this.fixedTicks);
    this.resumeRemaining = 0;
    this.phase = 'playing';
    this.crash('Ride ended');
  }
  clearInput() {
    if (this.wheelieHeld || this.forwardHeld || this.touchWeight)
      this.onInput?.({ type: 'clear' }, this.fixedTicks);
    this.wheelieHeld = false;
    this.forwardHeld = false;
    this.touchWeight = 0;
  }
  /** Every displayed increment equals the actual integer change of the score.
   * Continuous actions update one live counter instead of flooding the HUD. */
  private gain(text: string, points: number, group?: ScoreGain['group']) {
    if (!Number.isFinite(points) || points <= 0) return;
    const before = Math.floor(this.score);
    this.score += points;
    const earned = Math.floor(this.score) - before;
    if (!earned) return;
    const active =
      group &&
      this.scoreGains.find(
        (g) =>
          g.group === group &&
          g.text === text &&
          this.elapsed - g.updatedAt < 0.45,
      );
    if (active) {
      active.points += earned;
      active.updatedAt = this.elapsed;
    } else {
      if (this.scoreGains.length >= 10) this.scoreGains.shift();
      this.scoreGains.push({
        serial: ++this.scoreGainSerial,
        text,
        points: earned,
        updatedAt: this.elapsed,
        group,
      });
    }
  }
  skill(text: string, points: number) {
    this.gain(text, points);
    this.event = { text, kind: 'skill', serial: this.event.serial + 1 };
  }
  crash(cause = 'Traffic collision', obstacle: Obstacle | null = null) {
    if (this.phase !== 'playing') return;
    this.phase = 'crashed';
    this.blitzerFlashRemaining = 0;
    if (this.policeChase) {
      this.policeChase = false;
      this.policeRamRemaining = 0;
      this.policeOutcome = 'caught';
      this.policeOutcomeSerial++;
    }
    if (this.policeVehicle.phase === 'chasing') {
      // End pursuit logic without removing an existing car from the crash scene.
      // Camera-triggered cars retain their existing hidden state as well.
      this.policeVehicle.phase = 'idle';
    }
    this.policeJumpTarget = null;
    this.crashObstacle = obstacle;
    this.clearInput();
    this.scrapeIntensity = 0;
    this.scrapeMaterial = null;
    this.towJumpActive = false;
    this.constructionJumpActive = false;
    this.towCarrier = null;
    this.towSafeObstacles.clear();
    this.towTransferCars.clear();
    this.event = { text: cause, kind: 'crash', serial: this.event.serial + 1 };
  }
  advance(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.phase === 'paused') {
      if (this.resumeRemaining > 0) {
        this.resumeRemaining = Math.max(
          0,
          this.resumeRemaining - Math.min(dt, 0.1),
        );
        if (this.resumeRemaining < 1e-8) {
          this.resumeRemaining = 0;
          this.phase = 'playing';
          this.accumulator = 0;
          this.clearInput();
        }
      }
      return; // no distance/traffic/score/input simulation during 3-2-1
    }
    if (this.phase !== 'playing') return;
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator + 1e-12 >= STEP && this.phase === 'playing') {
      this.tick(STEP);
      this.accumulator = Math.max(0, this.accumulator - STEP);
    }
  }
  private spawnWave() {
    const section = this.world.at(this.distance + 145)!.kind;
    const environment = TRAFFIC_ENVIRONMENTS[section];
    // Choose a wave once and keep it while waiting for a safe arrival gap.
    // Re-rolling on every retry biased traffic toward fast tow trucks.
    if (!this.pendingWave || this.pendingWave.section !== section) {
      const moving =
        !environment.kinds.includes('construction') &&
        this.distance > 220 &&
        this.random() < 0.38 + this.difficulty * 0.24;
      let velocity = moving
        ? Math.min(
            TRAFFIC_FLOW.maximumCarSpeed,
            this.speed * (0.15 + this.random() * 0.08),
          )
        : 0;
      const kinds: ObstacleKind[] = [];
      const pool: readonly TrafficKind[] = environment.kinds.includes(
        'construction',
      )
        ? environment.kinds
        : [...environment.kinds, 'car', 'car'];
      let first: ObstacleKind = pool[Math.floor(this.random() * pool.length)];
      if (first === 'towtruck' && this.distance < 500) first = 'car';
      if (first === 'construction' && this.random() < 0.28) first = 'ramp';
      kinds.push(first);
      // A second lane is occupied only for the tow-truck side-jump encounter.
      if (first === 'towtruck' && this.distance > 350 &&
        this.random() < TRAFFIC_FLOW.towCarPairChance) kinds.push('car');
      // A generated ramp truck travels continuously. Its relative speed leaves
      // a usable climb interval without ever freezing on the loading bed.
      if (kinds.includes('towtruck'))
        velocity = Math.min(
          TRAFFIC_FLOW.maximumTrafficSpeed,
          Math.max(0, this.speed - TRAFFIC_FLOW.towClosingSpeed),
        );
      this.pendingWave = { section, kinds, velocity };
    }
    const { kinds: nextKinds, velocity } = this.pendingWave;
    const count = nextKinds.length;
    const candidates = [-1, 0, 1];
    const nextHalfLength = Math.max(
      ...nextKinds.map((k) => isRoadEvent(k)
        ? ROAD_EVENTS[k].contactHalfLength
        : TRAFFIC_SHAPES[k].contactHalfLength),
    );
    const arrival = this.arrivalTime(145, velocity);
    if (
      this.obstacles.some(
        (o) =>
          o.active &&
          o.z > 0 &&
          arrival - this.arrivalTime(o.z, o.velocity) <
            trafficArrivalGap(
              this.speed,
              o.velocity,
              velocity,
              isRoadEvent(o.kind)
                ? ROAD_EVENTS[o.kind].contactHalfLength
                : TRAFFIC_SHAPES[o.kind].contactHalfLength,
              nextHalfLength,
            ),
      )
    ) {
      this.spawnIn = 7;
      return;
    }
    // Arrival gaps protect the rider, while this guard protects the entire
    // visible road: a slower following car must not drift beside an older one.
    const nextOrdinary = nextKinds.filter((kind) => kind === 'car' || kind === 'van');
    if (nextOrdinary.some((kind) => this.obstacles.some((o) => {
      if (!o.active || (o.kind !== 'car' && o.kind !== 'van')) return false;
      const sharedLifetime = Math.min(
        this.arrivalTime(Math.max(0, o.z + 18), o.velocity),
        this.arrivalTime(163, velocity),
      );
      return !trafficSeparatedUntilPass(
        o.z,
        o.velocity,
        velocity,
        TRAFFIC_SHAPES[o.kind].contactHalfLength,
        TRAFFIC_SHAPES[kind].contactHalfLength,
        sharedLifetime,
      );
    }))) {
      this.spawnIn = 7;
      return;
    }
    // Each new wave closes the previous safe lane. Sweep through adjacent
    // lanes, so no lane can be camped and the next opening is always reachable.
    const previousSafe = this.nextSafe;
    if (Math.abs(this.nextSafe) === 1) this.safeDirection = -this.nextSafe;
    this.nextSafe += this.safeDirection;
    const lanes = [
      previousSafe,
      ...candidates.filter((l) => l !== this.nextSafe && l !== previousSafe),
    ];
    const patrolReady =
      this.distance >= this.nextPatrolDistance &&
      this.elapsed >= this.policeReadyAt &&
      this.score >= SPEED_CAMERA.firstScore &&
      this.policeVehicle.phase === 'idle' &&
      !this.speedCamera.active &&
      !this.obstacles.some((o) => o.active && o.police);
    let patrolSpawned = false;
    for (let i = 0; i < count; i++) {
      const patrol: boolean =
        patrolReady && !patrolSpawned && nextKinds[i] === 'car';
      const vehicle = this.spawn(
        nextKinds[i],
        lanes[i],
        145,
        0,
        velocity,
        patrol,
      );
      patrolSpawned ||= patrol && !!vehicle;
    }
    if (patrolSpawned) this.nextPatrolDistance = this.distance + 1800;
    this.pendingWave = null;
    this.spawnIn = Math.max(
      10,
      trafficWaveSpacing(
        environment.initialSpacing,
        environment.minimumSpacing,
        this.difficulty,
      ) *
        0.8 -
        this.random() * 4,
    );
    this.spawnWaveSign();
  }
  private spawnWaveSign() {
    // Daily progress is stored outside the fixed-step engine. A long ride can
    // keep collecting small point bonuses, including after UTC midnight.
    if (this.collectedSigns === COMPLETE_SIGN_MASK && this.distance >= this.nextSignAttempt) {
      this.collectedSigns = 0;
      this.signSequence = 0;
    }
    if (
      this.collectedSigns === COMPLETE_SIGN_MASK ||
      this.distance < this.nextSignAttempt ||
      !signScoreReady(this.collectedSigns, this.score) ||
      this.signs.some((s) => s.active)
    )
      return;
    const id = nextMissingSign(
      this.collectedSigns,
      this.signs,
      this.signSequence,
    );
    if (!id) return;
    const arrival = this.arrivalTime(128, 0);
    const lane = [...new Set([this.nextSafe, 0, -1, 1])].find((candidate) =>
      this.obstacles.every((o) => {
        if (!o.active) return true;
        const shape = isRoadEvent(o.kind)
          ? ROAD_EVENTS[o.kind]
          : TRAFFIC_SHAPES[o.kind];
        const atPickup = o.z - 128 + o.velocity * arrival;
        return (
          Math.abs(atPickup) > shape.contactHalfLength + 6 ||
          Math.abs(candidate * LANE - (o.lane * LANE + o.offsetX)) >
            shape.contactHalfWidth + 0.1
        );
      }),
    );
    if (lane === undefined) return;
    if (this.spawnSign(id, lane, 128)) {
      this.signSequence = (SIGN_IDS.indexOf(id) + 1) % SIGN_IDS.length;
      this.nextSignAttempt = this.distance + SIGN_DISTANCE_GAP + this.random() * 120;
    }
  }
  /** At most the pooled signs can be collected between renderer callbacks. */
  signPickupId(serial: number): SignId | null {
    if (!Number.isInteger(serial) || serial <= 0) return null;
    const pickup = this.signPickupHistory[serial % this.signPickupHistory.length];
    return pickup.serial === serial ? pickup.id : null;
  }
  spawnSign(id: SignId, lane: number, z: number) {
    if (
      !SIGN_IDS.includes(id) ||
      !Number.isFinite(lane) ||
      !Number.isFinite(z) ||
      this.collectedSigns & signBit(id) ||
      this.signs.some((s) => s.active && s.id === id)
    )
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
    const speed = Math.max(0.1, this.speed - velocity),
      acceleration = this.bike.acceleration;
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
    police = false,
  ) {
    if (
      !Number.isFinite(lane) ||
      !Number.isFinite(z) ||
      !Number.isFinite(offsetX)
    )
      return;
    const o = this.obstacles.find((x) => !x.active);
    if (o) {
      this.towSafeObstacles.delete(o);
      this.towTransferCars.delete(o);
      if (this.towWarningFor === o) this.towWarningFor = null;
      Object.assign(o, {
        spawnId: ++this.spawnSerial,
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
                Math.min(
                  TRAFFIC_FLOW.maximumTrafficSpeed,
                  Number.isFinite(velocity) ? velocity : 0,
                ),
              ),
        rampUsed: false,
        airNearMiss: false,
        lateEvade: false,
        police,
      });
    }
    return o;
  }
  private doingPoliceStunt() {
    return (
      this.wheelie ||
      this.wheelieAngle > 0.12 ||
      this.height > 0.12 ||
      this.towJumpActive
    );
  }
  private startPoliceChase(patrol?: Obstacle) {
    if (
      this.policeChase ||
      this.policeVehicle.phase !== 'idle' ||
      this.elapsed < this.policeReadyAt ||
      !this.doingPoliceStunt()
    )
      return;
    if (patrol && (!patrol.active || !patrol.police)) return;
    const p = this.policeVehicle;
    Object.assign(p, createPoliceVehicle(), {
      phase: 'chasing',
      visible: !!patrol,
      x: patrol ? patrol.lane * LANE + patrol.offsetX : this.x,
      z: patrol ? patrol.z : POLICE.followZ,
      velocity: patrol ? patrol.velocity : this.speed,
    });
    if (patrol) patrol.active = false;
    // Camera and patrol encounters share one recovery window. A camera must
    // not leave an overdue patrol waiting to trigger as soon as its wreck ends.
    this.nextPatrolDistance = this.distance + 1800;
    for (const obstacle of this.obstacles) {
      // A real patrol keeps its exact contact pose; only an unseen speed-camera
      // response may choose a clear spawn position behind existing traffic.
      if (patrol) break;
      if (!obstacle.active) continue;
      const shape = policeTargetShape(obstacle);
      if (
        shape &&
        Math.abs(p.x - (obstacle.lane * LANE + obstacle.offsetX)) <
          (shape.width + TRAFFIC_SHAPES.car.width) / 2
      )
        if (obstacle.z - shape.frontZ > p.z - TRAFFIC_SHAPES.car.rearZ)
          p.z = Math.min(
            p.z,
            obstacle.z - shape.rearZ + TRAFFIC_SHAPES.car.frontZ - 0.1,
          );
    }
    this.policeChase = true;
    this.policeProgress = 0;
    this.policeRamRemaining = POLICE.chaseSeconds;
    this.policeOutcome = 'none';
    this.policeImpactTarget = null;
    this.policeJumpTarget = null;
    this.policeRamObstacle = null;
    this.event = {
      text: 'HÄNGE SIE AB · CLOSE CALL ODER SPRUNG',
      kind: 'warning',
      serial: this.event.serial + 1,
    };
  }
  private checkBlitzer() {
    this.cameraSchedule.update(
      this.score,
      this.distance,
      this.policeVehicle.phase === 'idle' &&
        this.elapsed >= this.policeReadyAt &&
        !this.obstacles.some((o) => o.active && o.police),
      (distance) => {
        const section = this.world.at(distance);
        return (
          !!section &&
          section.kind !== 'tunnel' &&
          !section.kind.startsWith('bridge')
        );
      },
    );
    const camera = this.speedCamera;
    if (
      !camera.active ||
      camera.triggered ||
      this.policeVehicle.phase !== 'idle' ||
      this.elapsed < this.policeReadyAt ||
      Math.abs(camera.distance - this.distance) > SPEED_CAMERA.triggerRange ||
      !this.doingPoliceStunt()
    )
      return;
    this.startPoliceChase();
    if (!this.policeChase) return;
    camera.triggered = true;
    this.blitzerFlashSerial++;
    this.blitzerFlashRemaining = 0.28;
  }
  private policeCrashInto(target: Obstacle) {
    if (
      !this.policeChase ||
      !target.active ||
      target.police ||
      !policeTargetShape(target) ||
      // The pursuing car must first be behind the causative bumper. A close
      // call made while the passed patrol is still drawing back is an ordinary
      // near miss, not permission to teleport through that target for a crash.
      this.policeVehicle.z > target.z + policeImpactOffset(target) - 0.35
    )
      return;
    this.policeChase = false;
    this.policeRamRemaining = 0;
    this.policeProgress = 0;
    this.policeOutcome = 'escaped';
    this.policeOutcomeSerial++;
    this.policeJumpTarget = null;
    this.policeImpactTarget = target;
    this.policeTargetId = target.spawnId;
    this.policeImpactEndZ = policeImpactOffset(target);
    this.policeImpactReported = false;
    this.rememberPoliceTarget(target);
    const p = this.policeVehicle;
    p.phase = 'approach';
    p.visible = true;
    p.age = 0;
    this.skill('POLIZEI ABGEHÄNGT', STUNT_POINTS.policeEscape);
  }
  private rememberPoliceTarget(target: Obstacle) {
    Object.assign(this.policeTargetLast, {
      x: target.lane * LANE + target.offsetX,
      worldDistance: this.distance + target.z,
      velocity: target.velocity,
      elapsed: this.elapsed,
    });
  }
  private reportPoliceImpact(fallback: boolean) {
    if (this.policeImpactReported) return;
    this.policeImpactReported = true;
    const last = this.policeTargetLast;
    const worldDistance = fallback
      ? last.worldDistance +
        last.velocity * (this.elapsed - last.elapsed) +
        this.policeImpactEndZ -
        TRAFFIC_SHAPES.car.frontZ
      : this.distance + this.policeVehicle.z - TRAFFIC_SHAPES.car.frontZ;
    Object.assign(this.policeImpact, {
      serial: this.policeImpact.serial + 1,
      targetSpawnId: this.policeTargetId,
      x: fallback ? last.x : this.policeVehicle.x,
      z: worldDistance - this.distance,
      worldDistance,
      fallback,
    });
  }
  private policeRearEnd() {
    if (!this.policeChase) return;
    const p = this.policeVehicle;
    this.policeChase = false;
    this.policeRamRemaining = 0;
    this.policeProgress = 1;
    this.policeOutcome = 'caught';
    this.policeOutcomeSerial++;
    Object.assign(p, {
      phase: 'ramming',
      visible: true,
      age: 0,
      yaw: 0,
      roll: 0,
      pitch: 0,
      impactSpeed: Math.max(0, p.velocity - this.speed),
    });
    this.policeRamObstacle = {
      ...this.obstacles[0],
      spawnId: -1,
      active: true,
      kind: 'car',
      lane: this.lane,
      offsetX: p.x - this.lane * LANE,
      z: p.z,
      police: true,
      velocity: p.velocity,
      passed: true,
      color: 0,
    };
    this.crash('POLIZEI HAT DICH GERAMMT', this.policeRamObstacle);
  }
  private clearPoliceVehicle() {
    this.policeReadyAt = this.elapsed + POLICE.encounterCooldownSeconds;
    Object.assign(this.policeVehicle, createPoliceVehicle());
    this.policeImpactTarget = null;
    this.policeTargetId = 0;
    this.policeJumpTarget = null;
  }
  private updatePolice(dt: number, travel: number) {
    const p = this.policeVehicle;
    if (p.phase === 'idle' || p.phase === 'ramming') return;
    // The patrol already travelled in the NPC loop this tick. Its first
    // pursuit frame must keep that exact visible pose rather than travel twice.
    if (p.phase === 'chasing' && p.visible && p.age === 0) {
      p.age += dt;
      return;
    }
    p.age += dt;
    if (p.phase === 'approach') {
      p.z -= travel;
      const target = this.policeImpactTarget;
      if (!target?.active || target.spawnId !== this.policeTargetId) {
        this.reportPoliceImpact(true);
        this.clearPoliceVehicle();
        return;
      }
      this.rememberPoliceTarget(target);
      // The cause of this escape owns the impact even after it passes behind
      // the rider. Offscreen feedback belongs to presentation, never retargeting.
      const goalX = target.lane * LANE + target.offsetX;
      const goalZ = target.z + this.policeImpactEndZ;
      const startX = p.x,
        startZ = p.z;
      const riderBlocks = (
        fromX: number,
        toX: number,
        fromZ: number,
        toZ: number,
      ) =>
        Math.max(fromZ, toZ) > -5 &&
        Math.min(fromZ, toZ) < 4 &&
        Math.min(fromX, toX) < this.x + 1.7 &&
        Math.max(fromX, toX) > this.x - 1.7;
      const lateralClear = (x: number) =>
        !riderBlocks(p.x, x, p.z, p.z) &&
        !firstPoliceHit(this.obstacles, p.x, p.z, x, p.z, target);
      const forwardClear = (x: number) =>
        !riderBlocks(x, x, p.z, Math.min(goalZ, p.z + 7)) &&
        !firstPoliceHit(
          this.obstacles,
          x,
          p.z,
          x,
          Math.min(goalZ, p.z + 7),
          target,
        );
      const candidates = [goalX, -LANE, 0, LANE].sort(
        (a, b) => Math.abs(a - goalX) - Math.abs(b - goalX),
      );
      const laneX = candidates.find((x) => lateralClear(x) && forwardClear(x));
      const nextX =
        p.x +
        Math.max(
          -POLICE.lateralSpeed * dt,
          Math.min(POLICE.lateralSpeed * dt, (laneX ?? p.x) - p.x),
        );
      if (lateralClear(nextX)) p.x = nextX;
      const aligned = Math.abs(p.x - goalX) < 0.1;
      // Finish the lane change behind a target's bumper, then drive into it.
      const limitZ = goalZ - (aligned ? 0 : 0.35);
      const gap = Math.max(0, limitZ - p.z);
      const contactSpeed = POLICE.impactClosingSpeed;
      const targetVelocity = target.velocity;
      const desiredVelocity = Math.min(
        this.speed + POLICE.escapeClosingSpeed,
        targetVelocity +
          Math.sqrt(
            contactSpeed * contactSpeed + 2 * POLICE.escapeBraking * gap,
          ),
      );
      const velocity =
        p.velocity +
        Math.max(
          -POLICE.escapeBraking * dt,
          Math.min(
            POLICE.escapeAcceleration * dt,
            desiredVelocity - p.velocity,
          ),
        );
      const nextZ = Math.min(limitZ, p.z + velocity * dt);
      if (nextZ > p.z && !riderBlocks(p.x, p.x, p.z, nextZ)) {
        const obstruction = firstPoliceHit(
          this.obstacles,
          p.x,
          p.z,
          p.x,
          nextZ,
          target,
        );
        const fraction = obstruction
          ? Math.max(0, obstruction.fraction - 0.001)
          : 1;
        p.z += (nextZ - p.z) * fraction;
      }
      p.velocity = Math.max(0, (p.z - startZ) / dt);
      p.yaw = Math.max(
        -0.35,
        Math.min(0.35, -Math.atan2(p.x - startX, Math.max(0.1, p.z - startZ))),
      );
      const ramp =
        target?.kind === 'towtruck' && aligned
          ? policeRampPose(target.z - p.z)
          : { y: 0, pitch: 0 };
      p.y = ramp.y;
      p.pitch = ramp.pitch;
      if (aligned && p.z >= goalZ - 0.001 && p.z <= goalZ + 0.04) {
        p.phase = 'wrecked';
        p.age = 0;
        p.impactSpeed = Math.max(0, velocity - target.velocity);
        p.impactSide = p.x < this.x ? -1 : 1;
        // The short collision impulse removes forward closing speed. The car
        // then recoils and brakes independently; it is never parented to an NPC.
        p.velocity = target.velocity - Math.min(2, p.impactSpeed * 0.2);
        this.reportPoliceImpact(false);
      } else if (p.age > POLICE.escapeSeconds) {
        this.reportPoliceImpact(true);
        this.clearPoliceVehicle();
      }
      return;
    }
    if (p.phase === 'wrecked') {
      let target = this.policeImpactTarget;
      if (!target?.active || target.spawnId !== this.policeTargetId) {
        this.policeImpactTarget = null;
        target = null;
      }
      p.z -= travel;
      const velocity =
        Math.sign(p.velocity) *
        Math.max(0, Math.abs(p.velocity) - POLICE.wreckBraking * dt);
      const nextZ = p.z + (p.velocity + velocity) * 0.5 * dt;
      const hit = firstPoliceHit(this.obstacles, p.x, p.z, p.x, nextZ, target);
      p.z += (nextZ - p.z) * (hit ? Math.max(0, hit.fraction - 0.001) : 1);
      p.velocity = hit ? 0 : velocity;
      // Keep the recoil outside the target even if its own speed changes.
      if (target) p.z = Math.min(p.z, target.z + this.policeImpactEndZ);
      const ramp =
        target?.kind === 'towtruck'
          ? policeRampPose(target.z - p.z)
          : { y: 0, pitch: 0 };
      const response = Math.min(1, p.impactSpeed / 10) * Math.exp(-p.age * 3.8);
      p.y = ramp.y + Math.max(0, Math.sin(p.age * 14)) * response * 0.022;
      p.pitch = ramp.pitch - Math.sin(p.age * 15) * response * 0.065;
      p.roll = Math.sin(p.age * 11) * response * p.impactSide * 0.018;
      // Whole-car response pivots at the road origin: compensate the axle/tire
      // corners so even the lowest wheel remains on or above its support plane.
      p.y +=
        1.85 * Math.abs(Math.sin(p.pitch - ramp.pitch)) +
        1.055 * Math.abs(Math.sin(p.roll));
      p.yaw += (p.impactSide * 0.045 - p.yaw) * (1 - Math.exp(-dt * 4));
      if (p.z < POLICE.retireZ) this.clearPoliceVehicle();
      return;
    }
    p.z -= travel;
    const remaining = this.policeRamRemaining;
    const desiredX = this.lane * LANE;
    const ahead = firstPoliceHit(this.obstacles, p.x, p.z, p.x, p.z + 7);
    let targetX = p.x;
    if (
      p.z < POLICE.ramZ - 0.1 &&
      !firstPoliceHit(this.obstacles, p.x, p.z, desiredX, p.z)
    )
      targetX = desiredX;
    if (ahead && p.z < POLICE.ramZ - 0.1) {
      const lane = Math.max(-1, Math.min(1, Math.round(p.x / LANE)));
      const candidates = [this.lane, lane - 1, lane + 1].filter(
        (v) => v >= -1 && v <= 1,
      );
      const clear = candidates.find(
        (v) =>
          !firstPoliceHit(this.obstacles, p.x, p.z, v * LANE, p.z) &&
          !firstPoliceHit(this.obstacles, v * LANE, p.z, v * LANE, p.z + 7),
      );
      if (clear !== undefined) targetX = clear * LANE;
    }
    const nextX =
      p.x +
      Math.max(
        -POLICE.lateralSpeed * dt,
        Math.min(POLICE.lateralSpeed * dt, targetX - p.x),
      );
    if (!firstPoliceHit(this.obstacles, p.x, p.z, nextX, p.z)) p.x = nextX;
    const approach = Math.max(0, Math.min(1, (2 - remaining) / 2));
    const goalZ = POLICE.followZ + (POLICE.ramZ - POLICE.followZ) * approach;
    const approachVelocity =
      remaining < 2 ? (POLICE.ramZ - POLICE.followZ) / 2 : 0;
    const velocity = Math.max(
      0,
      Math.min(
        this.speed + 26,
        this.speed + approachVelocity + (goalZ - p.z - travel) * 5,
      ),
    );
    // An adjacent patrol can start just ahead of this rear bumper. Let normal
    // road travel draw it back first; a cap may only limit forward motion and
    // must never move that existing car backwards in one frame.
    const nextZ = p.z > POLICE.ramZ
      ? p.z + velocity * dt
      : Math.min(POLICE.ramZ, p.z + velocity * dt);
    const hit = firstPoliceHit(this.obstacles, p.x, p.z, p.x, nextZ);
    const fraction = hit ? Math.max(0, hit.fraction - 0.001) : 1;
    p.z += (nextZ - p.z) * fraction;
    p.velocity = velocity * fraction;
    const laneObstructed =
      Math.abs(p.x - desiredX) > 0.15 &&
      !!firstPoliceHit(this.obstacles, p.x, p.z, desiredX, p.z);
    if (!hit && !laneObstructed) {
      const canRam =
        p.z >= POLICE.ramZ - 0.005 &&
        Math.abs(p.x - this.x) < 0.3 &&
        this.height < 0.45 &&
        !firstPoliceHit(this.obstacles, p.x, p.z, this.x, POLICE.ramZ);
      this.policeRamRemaining = Math.max(canRam ? 0 : STEP, remaining - dt);
      if (this.policeRamRemaining <= 1e-8 && canRam) {
        this.policeRearEnd();
        return;
      }
    }
    this.policeProgress = 1 - this.policeRamRemaining / POLICE.chaseSeconds;
  }
  private cabContact(localZ: number) {
    const reach = trafficFrontReach(this.bike.id, Math.max(this.towPitch, this.wheelieAngle));
    return localZ - reach < TOW_RAMP.cabRearZ + 0.08;
  }
  private airBalance(dt: number) {
    this.liftPull *= Math.exp(-dt * 7);
    this.throttleLoad +=
      (this.throttleInput - this.throttleLoad) * (1 - Math.exp(-dt * 9));
    this.forwardLoad +=
      (this.forwardInput - this.forwardLoad) * (1 - Math.exp(-dt * 12));
    const recover =
      this.wheelieAngle < this.balanceProfile.balancePoint ? 0.48 : 0.18;
    this.wheelieAngularVelocity +=
      (0.52 * this.throttleLoad -
        1.12 * this.forwardLoad -
        1.8 * this.wheelieAngularVelocity -
        recover * this.wheelieAngle -
        recover * 0.55) *
      dt;
    this.wheelieAngle = Math.max(
      0,
      this.wheelieAngle + this.wheelieAngularVelocity * dt,
    );
    if (this.wheelieAngle === 0 && this.wheelieAngularVelocity < 0)
      this.wheelieAngularVelocity = 0;
  }
  private tick(dt: number) {
    this.fixedTicks++;
    const previousElapsed = this.elapsed;
    this.elapsed += dt;
    this.speed = speedAtTime(this.elapsed, this.bike);
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    const travel =
      distanceAtTime(this.elapsed, this.bike) -
      distanceAtTime(previousElapsed, this.bike);
    this.distance += travel;
    this.blitzerFlashRemaining = Math.max(0, this.blitzerFlashRemaining - dt);
    this.world.advance(this.distance);
    this.roadRoughness *= Math.exp(-dt * 7);
    this.surfaceGrip += (1 - this.surfaceGrip) * (1 - Math.exp(-dt * 1.8));
    for (let i = this.scoreGains.length - 1; i >= 0; i--)
      if (this.elapsed - this.scoreGains[i].updatedAt > 1.25)
        this.scoreGains.splice(i, 1);
    this.gain('FAHREN', travel * 0.12, 'ride');
    this.laneChangeAge = Math.min(1, this.laneChangeAge + dt);
    const steeringLead =
      this.height > 0 || this.wheelie
        ? 1
        : Math.max(0, Math.min(1, (this.laneChangeAge - 0.055) / 0.06));
    if (this.towJumpActive) {
      this.transferAge += dt;
      this.x = transferX(
        this.transferOriginX,
        this.lane * LANE,
        this.transferAge,
      );
    } else {
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
    }
    const approaching = this.obstacles.find(
      (o) =>
        o.active &&
        o.kind === 'towtruck' &&
        !o.rampUsed &&
        o.lane === this.lane &&
        o.z < this.speed * 1.3 + TOW_RAMP.rearZ &&
        o.z > TOW_RAMP.rearZ,
    );
    if (approaching && this.towWarningFor !== approaching) {
      this.towWarningFor = approaching;
      this.event = {
        text: 'RAMPE · SEITLICH ABSPRINGEN',
        kind: 'warning',
        serial: this.event.serial + 1,
      };
    }
    let queuedTowLane: number | null = null;
    if (!this.towCarrier && this.height === 0) {
      const ramp = this.obstacles.find((o) => {
        if (!o.active || o.kind !== 'towtruck' || o.rampUsed) return false;
        const localZ = o.z - (travel - o.velocity * dt);
        const front =
          RAMP_FRONT_CONTACT[this.bike.id] ?? RAMP_FRONT_CONTACT['450'];
        return (
          localZ >= towDeckPosition(this.bike.id) &&
          localZ + front.axle - front.radius <= TOW_RAMP.rearZ &&
          Math.abs(this.x - (o.lane * LANE + o.offsetX)) <=
            TRAFFIC_SHAPES.towtruck.contactHalfWidth
        );
      });
      if (ramp) {
        if (this.lane !== ramp.lane) queuedTowLane = this.lane;
        this.lane = ramp.lane;
        ramp.rampUsed = true;
        this.towCarrier = ramp;
        this.velocityY = 0;
        this.airLaneChangeUsed = false;
        // A single finite impulse at ramp entry; no ongoing forced angle reduction.
        this.rampEntryRemaining = rampEntryImpulse(
          this.wheelieAngle,
          this.speed - ramp.velocity,
        );
        this.event = {
          text: 'RAMPE · JETZT ABSPRINGEN',
          kind: 'warning',
          serial: this.event.serial + 1,
        };
      }
    }
    if (this.towCarrier) {
      const localZ =
        this.towCarrier.z - (travel - this.towCarrier.velocity * dt);
      // Real relative motion all the way to the cab. No 1.4 s carrier speed lock.
      const pose = towRampPose(this.bike.id, localZ, this.wheelieAngle);
      this.height = pose.height;
      this.towPitch = pose.pitch;
      this.velocityY = 0;
      if (queuedTowLane !== null) this.move(queuedTowLane - this.lane, false);
    } else this.towPitch *= Math.exp(-dt * 8);
    let supportedConstruction = false;
    if (!this.towCarrier && !this.towJumpActive && !this.constructionJumpActive && this.velocityY === 0) {
      const ramp = this.obstacles.find(o => o.active && o.kind === 'ramp' && !o.rampUsed
        && o.z > CONSTRUCTION_RAMP.lipZ
        && o.z - travel < CONSTRUCTION_RAMP.entryZ + 2
        && Math.abs(this.x - (o.lane * LANE + o.offsetX)) < CONSTRUCTION_RAMP.width / 2 - 0.12);
      if (ramp) {
        const localZ = ramp.z - travel;
        const pose = constructionRampPose(this.bike.id, localZ, this.wheelieAngle);
        this.height = pose.height; this.towPitch = pose.pitch;
        if (localZ <= CONSTRUCTION_RAMP.lipZ) {
          ramp.rampUsed = true;
          this.velocityY = CONSTRUCTION_RAMP.launchVelocity;
          this.constructionJumpActive = true;
          this.airLaneChangeUsed = false;
          this.launchSerial++;
          this.event = { text: 'BAUSTELLENSPRUNG', kind: 'skill', serial: this.event.serial + 1 };
        } else supportedConstruction = true;
      }
    }
    let landedTowJump = false, landedConstructionJump = false;
    if (!this.towCarrier && !supportedConstruction && (this.height > 0 || this.velocityY > 0)) {
      // Keep the original fixed gravity arc for ordinary and tow jumps.
      this.height += this.velocityY * dt - 0.5 * TOW_RAMP.gravity * dt * dt;
      this.velocityY -= TOW_RAMP.gravity * dt;
      if (this.height <= 0) {
        this.landingSpeed = Math.abs(this.velocityY);
        this.landingSerial++;
        this.height = 0;
        this.velocityY = 0;
        this.airLaneChangeUsed = false;
        this.towPitch = 0;
        if (this.constructionJumpActive) {
          this.constructionJumpActive = false;
          landedConstructionJump = true;
        }
        if (this.towJumpActive) {
          this.towJumpActive = false;
          landedTowJump = true;
          if (this.wheelieAngle < this.balanceProfile.balancePoint + 0.08) {
            this.wheelieAngle = Math.min(this.wheelieAngle, 0.1);
            this.wheelieAngularVelocity = Math.min(
              0,
              this.wheelieAngularVelocity,
            );
          }
        }
      }
    }
    const wasArmed = this.liftArmed;
    let touchdown = 0;
    if (this.towJumpActive || this.constructionJumpActive) this.airBalance(dt);
    else
      touchdown = advanceBalance(
        this,
        this.balanceProfile,
        this.speed,
        this.height === 0 || this.onTowTruck ? this.throttleInput : 0,
        this.forwardInput,
        dt,
      );
    if (this.onTowTruck) {
      const reaction = consumeRampImpulse(this.rampEntryRemaining, dt);
      this.rampEntryRemaining = reaction.remaining;
      this.wheelieAngularVelocity -= reaction.applied;
    } else this.rampEntryRemaining = 0;
    if (wasArmed && !this.liftArmed) this.wheelieLaunchSerial++;
    if (touchdown > 0.4) {
      this.landingSerial++;
      this.landingSpeed = touchdown * 2;
    }
    if (this.wheelieAngle >= this.balanceProfile.crashAngle) {
      this.crash('Overrotated the wheelie');
      return;
    }
    if (this.towCarrier) {
      const pose = towRampPose(
        this.bike.id,
        this.towCarrier.z - (travel - this.towCarrier.velocity * dt),
        this.wheelieAngle,
      );
      this.height = pose.height;
      this.towPitch = pose.pitch;
    }
    this.wheelie =
      this.wheelieAngle > 0.12 &&
      (this.height === 0 || this.onTowTruck || this.towJumpActive);
    this.checkBlitzer();
    const scrape = tailScrape(
      this.bike.id,
      this.wheelieAngle,
      this.balanceProfile,
    );
    this.scrapeIntensity =
      this.wheelie && this.height === 0 ? scrape.intensity : 0;
    this.scrapeMaterial = this.scrapeIntensity > 0 ? scrape.material : null;
    if (this.scrapeIntensity > 0) {
      this.gain('SCRAPE', travel * 12 * this.scrapeIntensity, 'scrape');
    }
    this.balanceQuality = this.wheelie
      ? balanceAccuracy(this, this.balanceProfile)
      : 0;
    if (this.wheelie) {
      this.wheelieMeters += travel;
      this.balancedSeconds += dt * this.balanceQuality;
      const risky = this.wheelieAngle > this.balanceProfile.balancePoint + 0.18;
      const tunnelWheelieBonus = this.environment.kind === 'tunnel' ? 1.1 : 1;
      this.gain(
        risky ? 'RISKY WHEELIE' : 'WHEELIE',
        travel *
          6 *
          wheelieScoreFactor(this, this.balanceProfile) *
          (this.speed / 22) *
          tunnelWheelieBonus,
        'wheelie',
      );
    } else this.balancedSeconds = 0;
    this.spawnIn -= travel;
    let policeEscapeTarget: Obstacle | null = null;
    // Landing ends eligibility. An already-entered side contact lasts only
    // until geometric separation, so the landing tick cannot crash inside it.
    if (landedTowJump) this.towTransferCars.clear();
    for (const o of this.obstacles) {
      if (!o.active) continue;
      const prev = o.z;
      o.z -= travel - o.velocity * dt;
      const dx = Math.abs(this.x - (o.lane * LANE + o.offsetX));
      const road = isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind] : undefined;
      const traffic = !isRoadEvent(o.kind) ? TRAFFIC_SHAPES[o.kind] : undefined;
      const length = road?.contactHalfLength ?? traffic!.contactHalfLength;
      if (o === this.towCarrier) {
        if (this.cabContact(o.z)) {
          this.crash('Missed the side jump', o);
          break;
        }
        continue;
      }
      const contactPitch = o.kind === 'car'
        ? carContactPitch(this.bike.id, this.wheelieAngle, this.towPitch)
        : Math.max(this.towPitch, this.wheelieAngle);
      const rearContact = traffic
        ? traffic.rearZ +
          (o.kind === 'car'
            ? carFrontReach(this.bike.id, contactPitch)
            : trafficFrontReach(this.bike.id, contactPitch))
        : length;
      const frontContact = traffic
        ? traffic.frontZ - (o.kind === 'car'
          ? carRearReach(this.bike.id, contactPitch)
          : 1)
        : -length;
      const overlap = o.z < rearContact && prev > frontContact;
      const contactWidth = road?.contactHalfWidth ?? traffic!.contactHalfWidth;
      if (o.kind === 'ramp') {
        const inLane = dx < CONSTRUCTION_RAMP.width / 2 - 0.12;
        if (inLane && o.z < CONSTRUCTION_RAMP.lipZ && o.z > CONSTRUCTION_RAMP.gapEndZ && this.height < 0.12) {
          this.crash('Baustellenlücke verfehlt', o);
          break;
        }
        if (o.z < frontContact) o.passed = true;
        if (o.z < -18) o.active = false;
        continue;
      }
      // An early queued swipe can launch before the truck's rear collision
      // box reaches us. Keep its exit exemption until we actually clear it.
      if (prev <= frontContact || dx >= contactWidth || (o.kind === 'car' && o.z >= rearContact))
        this.towSafeObstacles.delete(o);
      const top =
        o.kind === 'towtruck' && o.z > TOW_RAMP.cabRearZ
          ? o.z > TOW_RAMP.frontZ
            ? towRampHeight(o.z)
            : TOW_RAMP.frontHeight
          : (road?.height ?? traffic!.height);
      const airborneCar = o.kind === 'car' && this.height > 0.12;
      const tireClearance = airborneCar
        ? carJumpClearance(this.bike.id, this.height, contactPitch, o.z, dx, o.police)
        : -Infinity;
      if (this.towJumpActive && this.towTransferCars.has(o)
        && overlap && dx < contactWidth && o.z < TRAFFIC_SHAPES.car.rearZ
        && tireClearance < -0.015) {
        this.towSafeObstacles.add(o);
        this.towTransferCars.delete(o);
      }
      if (
        this.towJumpActive &&
        o.kind === 'car' &&
        overlap &&
        dx < contactWidth
      ) {
        if (Number.isFinite(tireClearance) && tireClearance >= -0.015) {
          o.cleared = true;
          o.rewardPoints = STUNT_POINTS.carJump;
          o.rewardText = 'AUTO ÜBERSPRUNGEN';
        }
      }
      // Tire clearance is infinite beside the car, where no surface lies
      // underneath the rider. Use its height for lateral close passes so
      // airborne evasions still count without widening the collision shape.
      const belowObstacle = airborneCar && dx < contactWidth
        ? tireClearance < -0.015
        : this.height < top;
      if (overlap && belowObstacle && !this.towSafeObstacles.has(o)) {
        const gap = dx - contactWidth;
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
                this.crash(response.crash, o);
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
            // Resolve a freshly crossed bumper at the tire's first contact.
            // Keeping a full fixed-step overshoot would start the visual crash
            // inside the car and force the bike to jump backwards to escape it.
            // Side/previously overlapping contacts and the ramp path stay put.
            if (prev >= rearContact) o.z = rearContact;
            this.crash(
              o.kind === 'construction'
                ? 'Construction barrier collision'
                : 'Traffic collision',
              o,
            );
            break;
          }
        } else {
          o.closest = Math.min(o.closest, gap);
          if (gap < CLOSE_CALL.gap && this.height > 0.1) o.airNearMiss = true;
          if (
            this.policeChase &&
            !o.police &&
            !road &&
            (gap < CLOSE_CALL.gap || o.lateEvade)
          )
            policeEscapeTarget ??= o;
        }
      }
      if (!o.passed && o.z < frontContact) {
        o.passed = true;
        if (o.police) this.startPoliceChase(o);
        const closeCall =
          !road && (o.closest < CLOSE_CALL.gap || o.lateEvade || o.airNearMiss);
        if (o.cleared && o.rewardPoints > 0) {
          this.skill(o.rewardText, o.rewardPoints);
          if (this.policeChase && !o.police && !road) policeEscapeTarget ??= o;
        } else if (
          (!road || o.kind === 'barrier') &&
          (o.closest < CLOSE_CALL.gap || o.lateEvade)
        ) {
          this.nearMisses++;
          this.skill(
            o.airNearMiss
              ? 'IN DER LUFT AUSGEWICHEN'
              : o.lateEvade
                ? 'CLOSE CALL'
                : 'KNAPP VORBEI',
            o.airNearMiss ? STUNT_POINTS.airEvade : STUNT_POINTS.nearMiss,
          );
          if (this.policeChase && closeCall && !o.police)
            policeEscapeTarget ??= o;
        }
      }
      // Preserve the causative pool slot throughout the bounded approach, even
      // offscreen. It stays an ordinary solid NPC moving at its original speed.
      const retained =
        (o === this.policeImpactTarget && o.spawnId === this.policeTargetId) ||
        (o === this.policeJumpTarget?.obstacle &&
          o.spawnId === this.policeJumpTarget.spawnId);
      const awaitingImpact =
        o === this.policeImpactTarget &&
        o.spawnId === this.policeTargetId &&
        this.policeVehicle.phase === 'approach';
      if (!awaitingImpact && o.z < (retained ? POLICE.retireZ : -18))
        o.active = false;
    }
    if (landedTowJump && this.phase === 'playing') {
      this.jumps++;
      this.skill('SPRUNG GELANDET', STUNT_POINTS.jump);
    }
    if (landedConstructionJump && this.phase === 'playing') {
      this.jumps++;
      this.skill('BAUSTELLENSPRUNG GELANDET', STUNT_POINTS.jump);
    }
    if (this.phase === 'playing') {
      const jump = this.policeJumpTarget;
      if (
        this.policeChase &&
        jump?.obstacle.active &&
        jump.spawnId === jump.obstacle.spawnId &&
        (landedTowJump ||
          (this.towJumpActive &&
            this.height > 0.12 &&
            Math.abs(
              this.x - (jump.obstacle.lane * LANE + jump.obstacle.offsetX),
            ) > TRAFFIC_SHAPES.towtruck.contactHalfWidth))
      )
        policeEscapeTarget = jump.obstacle;
      if (policeEscapeTarget) this.policeCrashInto(policeEscapeTarget);
      this.updatePolice(dt, travel);
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
          if (this.collectedSigns & signBit(sign.id)) continue;
          this.lastSignId = sign.id;
          this.signPickupSerial++;
          Object.assign(this.signPickupHistory[this.signPickupSerial % this.signPickupHistory.length],
            { serial: this.signPickupSerial, id: sign.id });
          this.collectedSigns |= signBit(sign.id);
          if (this.collectedSigns === COMPLETE_SIGN_MASK) {
            this.signSetCount++;
            for (const pending of this.signs) pending.active = false;
            this.skill('SIGNS · ALLE GESAMMELT', 45);
          } else this.skill(`SIGN · ${sign.id}`, 45);
        } else if (sign.z < -12) {
          sign.active = false;
          // Prioritise a missed letter at the next safe wave, not six letters later.
          this.signSequence = SIGN_IDS.indexOf(sign.id);
          this.nextSignAttempt = Math.min(
            this.nextSignAttempt,
            this.distance + SIGN_RETRY_DISTANCE,
          );
        }
      }
    if (this.phase === 'playing' && this.spawnIn <= 0) this.spawnWave();
  }
  stats(): RunStats {
    return {
      id: this.id,
      score: Math.floor(this.score),
      distance: Math.floor(this.distance),
      seconds: Math.floor(this.elapsed),
      bestCombo: 1,
      nearMisses: this.nearMisses,
      jumps: this.jumps,
      wheelieMeters: Math.floor(this.wheelieMeters),
      maxSpeed: Math.round(this.maxSpeed * 3.6),
      cause: this.event.kind === 'crash' ? this.event.text : 'Ride ended',
    };
  }
}
