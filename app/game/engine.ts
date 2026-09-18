import { TOW_TRANSFER, transferX } from './towTransfer';
import type { Bike, RunStats } from '../domain/types';
import { World, distanceAtTime, speedAtTime } from './world';
import { ROAD_EVENTS, TRAFFIC_ENVIRONMENTS, isRoadEvent, roadResponse, type RoadEventKind } from './roadEvents';
import { BALANCE, advanceBalance, balanceAccuracy, wheelieScoreFactor, tailScrape } from './wheelie';
import { TRAFFIC_SHAPES, TOW_RAMP, distanceDifficulty, towRampHeight, towRampPose,
  towDeckPosition, RAMP_FRONT_CONTACT, type TrafficKind } from './trafficDomain';
import { SIGN_IDS, type SignId } from './signCollectibles';
import { COMPLETE_SIGN_MASK, nextMissingSign, signBit, signScoreReady, SIGN_DISTANCE_GAP, SIGN_RETRY_DISTANCE } from './signSet';
import { rampEntryImpulse, consumeRampImpulse } from './rampEntry';
import { TRAFFIC_FLOW, trafficArrivalGap, trafficWaveSpacing } from './trafficFlow';
export const LANE = 2.8;
export const STEP = 1 / 60;
export type ObstacleKind = TrafficKind | RoadEventKind;
export interface Obstacle {
  active: boolean; kind: ObstacleKind; lane: number; offsetX: number; z: number;
  passed: boolean; closest: number; color: number; cleared: boolean;
  rewardPoints: number; rewardText: string; velocity: number; rampUsed: boolean;
}
export interface GameEvent { text: string; kind: 'skill' | 'warning' | 'crash'; serial: number }
export interface SignPickup { active: boolean; id: SignId; lane: number; z: number }
export class Engine {
  phase: 'ready' | 'playing' | 'paused' | 'crashed' = 'ready';
  elapsed = 0; distance = 0; score = 0; speed = 22; lane = 0; x = 0;
  height = 0; velocityY = 0; airLaneChangeUsed = false;
  launchSerial = 0; wheelieLaunchSerial = 0; towJumpActive = false; towPitch = 0;
  laneChangeSerial = 0; laneChangeDirection = 0; laneChangeAge = 1;
  landingSerial = 0; landingSpeed = 0; roadRoughness = 0; surfaceGrip = 1;
  wheelie = false; wheelieHeld = false; forwardHeld = false; touchWeight = 0;
  wheelieAngle = 0; wheelieAngularVelocity = 0; throttleLoad = 0; forwardLoad = 0;
  liftPull = 0; liftArmed = true; balanceQuality = 0;
  scrapeMaterial: 'metal' | 'plastic' | null = null;
  scrapeIntensity = 0; balancedSeconds = 0; wheelieMeters = 0;
  combo = 1; bestCombo = 1; comboTime = 0; nearMisses = 0; jumps = 0;
  collectedSigns = 0; signSetCount = 0; signPickupSerial = 0;
  lastSignId: SignId | null = null;
  signs: SignPickup[] = Array.from({ length: 8 }, () => ({ active: false, id: 'P', lane: 0, z: 0 }));
  maxSpeed = 22;
  event: GameEvent = { text: '', kind: 'skill', serial: 0 };
  obstacles: Obstacle[] = Array.from({ length: 32 }, () => ({ active: false, kind: 'car', lane: 0,
    offsetX: 0, z: 0, passed: false, closest: Infinity, color: 0, cleared: false,
    rewardPoints: 0, rewardText: '', velocity: 0, rampUsed: false }));
  readonly world: World;
  private rng: number;
  private spawnIn = 28;
  private nextSafe = 0;
  private pendingWave: { section: string; kinds: TrafficKind[]; velocity: number } | null = null;
  private wheelieChain = 0;
  private accumulator = 0;
  private towCarrier: Obstacle | null = null;
  private towSafeObstacles = new Set<Obstacle>();
  private scrapeMeters = 0;
  private signSequence = 0;
  private nextSignAttempt = 300;
  private rampEntryRemaining = 0;
  private transferAge = 0;
  private transferOriginX = 0;
  private towWarningFor: Obstacle | null = null;
  private id: string;
  constructor(public bike: Bike, seed = 5489) {
    this.rng = seed >>> 0;
    this.world = new World(seed, bike);
    this.id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${seed}`;
  }
  random() { this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0; return this.rng / 4294967296; }
  start() { if (this.phase === 'ready') this.phase = 'playing'; }
  get onTowTruck() { return this.towCarrier !== null; }
  move(direction: number) {
    if (this.phase !== 'playing' || !Number.isFinite(direction)) return;
    const airborne = !this.onTowTruck && (this.height > 0 || this.velocityY !== 0);
    const next = Math.max(-1, Math.min(1, this.lane + Math.sign(direction)));
    if (next === this.lane || (airborne && this.airLaneChangeUsed)) return;
    if (this.towCarrier && this.cabContact(this.towCarrier.z)) {
      this.crash('Missed the side jump'); return;
    }
    this.laneChangeDirection = next - this.lane;
    this.laneChangeAge = 0; this.laneChangeSerial++; this.lane = next;
    if (this.towCarrier) {
      // Only the truck being left gets a short exit exemption. Other vehicles
      // still collide if the rider jumps into them below their actual roof.
      this.towSafeObstacles.add(this.towCarrier);
      this.towCarrier = null;
      this.velocityY = TOW_TRANSFER.launchVelocity * (this.wheelie ? 0.94 : 1);
      if (this.wheelieAngle < this.balanceProfile.crashAngle * 0.72) this.wheelieAngularVelocity -= 0.58;
      this.transferAge = 0; this.transferOriginX = this.x;
      this.towJumpActive = true; this.airLaneChangeUsed = true; this.launchSerial++;
      this.event = { text: 'RAMP TRANSFER', kind: 'skill', serial: this.event.serial + 1 };
    } else if (airborne) this.airLaneChangeUsed = true;
  }
  get balanceProfile() { return BALANCE[this.bike.id] ?? BALANCE['450']; }
  get environment() { return this.world.at(this.distance)!; }
  get difficulty() { return distanceDifficulty(this.distance); }
  hold(value: boolean) { this.wheelieHeld = value && this.phase === 'playing'; }
  forward(value: boolean) { this.forwardHeld = value && this.phase === 'playing'; }
  weight(value: number) { this.touchWeight = this.phase === 'playing' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0; }
  get throttleInput() { return Math.max(this.wheelieHeld ? 1 : 0, this.touchWeight); }
  get forwardInput() { return Math.max(this.forwardHeld ? 1 : 0, -this.touchWeight); }
  pause() { if (this.phase === 'playing') { this.phase = 'paused'; this.clearInput(); } }
  resume() { if (this.phase === 'paused') this.phase = 'playing'; }
  clearInput() { this.wheelieHeld = false; this.forwardHeld = false; this.touchWeight = 0; }
  skill(text: string, points: number) {
    this.combo = Math.min(5, this.combo + 0.5); this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTime = 3.8; this.score += points * this.combo;
    this.event = { text, kind: 'skill', serial: this.event.serial + 1 };
  }
  crash(cause = 'Traffic collision') {
    if (this.phase !== 'playing') return;
    this.phase = 'crashed'; this.clearInput(); this.scrapeIntensity = 0; this.scrapeMaterial = null;
    this.towJumpActive = false; this.towCarrier = null; this.towSafeObstacles.clear();
    this.event = { text: cause, kind: 'crash', serial: this.event.serial + 1 };
  }
  advance(dt: number) {
    if (this.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator + 1e-12 >= STEP && this.phase === 'playing') {
      this.tick(STEP); this.accumulator = Math.max(0, this.accumulator - STEP);
    }
  }
  private spawnWave() {
    const section = this.world.at(this.distance + 145)!.kind;
    const environment = TRAFFIC_ENVIRONMENTS[section];
    // Choose a wave once and keep it while waiting for a safe arrival gap.
    // Re-rolling on every retry biased traffic toward fast tow trucks.
    if (!this.pendingWave || this.pendingWave.section !== section) {
      const moving = !environment.kinds.includes('construction') && this.distance > 220
        && this.random() < 0.38 + this.difficulty * 0.24;
      let velocity = moving ? Math.min(TRAFFIC_FLOW.maximumCarSpeed,
        this.speed * (0.25 + this.random() * 0.14)) : 0;
      const kinds: TrafficKind[] = [];
      const pool: readonly TrafficKind[] = environment.kinds.includes('construction')
        ? environment.kinds : [...environment.kinds, 'car', 'car'];
      const count = this.distance > 350 && this.random() <
        0.22 + Math.min(0.55, environment.doubleChance) * this.difficulty ? 2 : 1;
      for (let i = 0; i < count; i++) {
        let kind = pool[Math.floor(this.random() * pool.length)];
        if (kind === 'towtruck' && this.distance < 500) kind = 'car';
        kinds.push(kind);
      }
      // A generated ramp truck travels continuously. Its relative speed leaves
      // a usable climb interval without ever freezing on the loading bed.
      if (kinds.includes('towtruck')) velocity = Math.min(TRAFFIC_FLOW.maximumTrafficSpeed,
        Math.max(0, this.speed - TRAFFIC_FLOW.towClosingSpeed));
      this.pendingWave = { section, kinds, velocity };
    }
    const { kinds: nextKinds, velocity } = this.pendingWave;
    const count = nextKinds.length;
    const candidates = [-1, 0, 1];
    const nextHalfLength = Math.max(...nextKinds.map(k => TRAFFIC_SHAPES[k].contactHalfLength));
    const arrival = this.arrivalTime(145, velocity);
    if (this.obstacles.some(o => o.active && o.z > 0 &&
      arrival - this.arrivalTime(o.z, o.velocity) < trafficArrivalGap(
        this.speed, o.velocity, velocity,
        isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind].contactHalfLength : TRAFFIC_SHAPES[o.kind].contactHalfLength,
        nextHalfLength,
      ))) {
      this.spawnIn = 7; return;
    }
    const change = this.random() < 0.72 ? (this.random() < 0.5 ? -1 : 1) : 0;
    this.nextSafe = Math.max(-1, Math.min(1, this.nextSafe + change));
    const lanes = candidates.filter(l => l !== this.nextSafe);
    if (this.random() < 0.5) lanes.reverse();
    for (let i = 0; i < count; i++) this.spawn(nextKinds[i], lanes[i], 145, 0, velocity);
    this.pendingWave = null;
    this.spawnIn = Math.max(10, trafficWaveSpacing(environment.initialSpacing, environment.minimumSpacing, this.difficulty) * 0.84 - this.random() * 5);
    this.spawnWaveSign();
  }
  private spawnWaveSign() {
    if (this.collectedSigns === COMPLETE_SIGN_MASK || this.distance < this.nextSignAttempt
      || !signScoreReady(this.collectedSigns, this.score) || this.signs.some(s => s.active)) return;
    const id = nextMissingSign(this.collectedSigns, this.signs, this.signSequence);
    if (!id) return;
    const arrival = this.arrivalTime(128, 0);
    const lane = [...new Set([this.nextSafe, 0, -1, 1])].find(candidate => this.obstacles.every(o => {
      if (!o.active) return true;
      const shape = isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind] : TRAFFIC_SHAPES[o.kind];
      const atPickup = o.z - 128 + o.velocity * arrival;
      return Math.abs(atPickup) > shape.contactHalfLength + 6 ||
        Math.abs(candidate * LANE - (o.lane * LANE + o.offsetX)) > shape.contactHalfWidth + 0.1;
    }));
    if (lane === undefined) return;
    if (this.spawnSign(id, lane, 128)) {
      this.signSequence = (SIGN_IDS.indexOf(id) + 1) % SIGN_IDS.length;
      this.nextSignAttempt = this.distance + SIGN_DISTANCE_GAP + this.random() * 380;
    }
  }
  spawnSign(id: SignId, lane: number, z: number) {
    if (!SIGN_IDS.includes(id) || !Number.isFinite(lane) || !Number.isFinite(z)
      || (this.collectedSigns & signBit(id)) || this.signs.some(s => s.active && s.id === id)) return;
    const sign = this.signs.find(entry => !entry.active);
    if (sign) Object.assign(sign, { active: true, id, lane: Math.max(-1, Math.min(1, Math.round(lane))), z });
    return sign;
  }
  private arrivalTime(z: number, velocity: number) {
    const speed = Math.max(0.1, this.speed - velocity), acceleration = this.bike.acceleration;
    const untilCap = acceleration > 0 ? Math.max(0, (this.bike.maxSpeed - this.speed) / acceleration) : 0;
    const capDistance = speed * untilCap + 0.5 * acceleration * untilCap ** 2;
    if (acceleration > 0 && z < capDistance)
      return (2 * z) / (speed + Math.sqrt(speed * speed + 2 * acceleration * z));
    return untilCap + (z - capDistance) / Math.max(0.1, this.bike.maxSpeed - velocity);
  }
  spawn(kind: ObstacleKind, lane: number, z: number, offsetX = 0, velocity = 0) {
    if (!Number.isFinite(lane) || !Number.isFinite(z) || !Number.isFinite(offsetX)) return;
    const o = this.obstacles.find(x => !x.active);
    if (o) {
      this.towSafeObstacles.delete(o);
      if (this.towWarningFor === o) this.towWarningFor = null;
      Object.assign(o, { active: true, kind, lane, offsetX, z, passed: false, closest: Infinity,
        color: Math.floor(this.random() * 4), cleared: false, rewardPoints: 0, rewardText: '',
        velocity: kind === 'construction' || isRoadEvent(kind) ? 0 : Math.max(0,
          Math.min(TRAFFIC_FLOW.maximumTrafficSpeed, Number.isFinite(velocity) ? velocity : 0)), rampUsed: false });
    }
    return o;
  }
  private cabContact(localZ: number) {
    const front = RAMP_FRONT_CONTACT[this.bike.id] ?? RAMP_FRONT_CONTACT['450'];
    return localZ + front.axle - front.radius < TOW_RAMP.cabRearZ + 0.08;
  }
  private airBalance(dt: number) {
    this.liftPull *= Math.exp(-dt * 7);
    this.throttleLoad += (this.throttleInput - this.throttleLoad) * (1 - Math.exp(-dt * 9));
    this.forwardLoad += (this.forwardInput - this.forwardLoad) * (1 - Math.exp(-dt * 12));
    const recover = this.wheelieAngle < this.balanceProfile.crashAngle * 0.72 ? 0.48 : 0.18;
    this.wheelieAngularVelocity += (0.52 * this.throttleLoad - 1.12 * this.forwardLoad
      - 1.8 * this.wheelieAngularVelocity - recover * this.wheelieAngle - recover * 0.55) * dt;
    this.wheelieAngle = Math.max(0, this.wheelieAngle + this.wheelieAngularVelocity * dt);
    if (this.wheelieAngle === 0 && this.wheelieAngularVelocity < 0) this.wheelieAngularVelocity = 0;
  }
  private tick(dt: number) {
    const previousElapsed = this.elapsed;
    this.elapsed += dt; this.speed = speedAtTime(this.elapsed, this.bike);
    this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    const travel = distanceAtTime(this.elapsed, this.bike) - distanceAtTime(previousElapsed, this.bike);
    this.distance += travel; this.world.advance(this.distance);
    this.roadRoughness *= Math.exp(-dt * 7);
    this.surfaceGrip += (1 - this.surfaceGrip) * (1 - Math.exp(-dt * 1.8));
    this.score += travel * 0.12;
    this.laneChangeAge = Math.min(1, this.laneChangeAge + dt);
    const steeringLead = this.height > 0 || this.wheelie ? 1 :
      Math.max(0, Math.min(1, (this.laneChangeAge - 0.055) / 0.06));
    if (this.towJumpActive) {
      this.transferAge += dt;
      this.x = transferX(this.transferOriginX, this.lane * LANE, this.transferAge);
    } else {
      this.x += (this.lane * LANE - this.x) * Math.min(1,
        dt * this.bike.handling * this.surfaceGrip * (this.wheelie ? 0.78 : 1) * steeringLead);
    }
    const approaching = this.obstacles.find(o => o.active && o.kind === 'towtruck' && !o.rampUsed
      && o.lane === this.lane && o.z < this.speed * 1.3 + TOW_RAMP.rearZ && o.z > TOW_RAMP.rearZ);
    if (approaching && this.towWarningFor !== approaching) {
      this.towWarningFor = approaching;
      this.event = { text: 'RAMPE · SEITLICH ABSPRINGEN', kind: 'warning', serial: this.event.serial + 1 };
    }
    let queuedTowLane: number | null = null;
    if (!this.towCarrier && this.height === 0) {
      const ramp = this.obstacles.find(o => {
        if (!o.active || o.kind !== 'towtruck' || o.rampUsed) return false;
        const localZ = o.z - (travel - o.velocity * dt);
        const front = RAMP_FRONT_CONTACT[this.bike.id] ?? RAMP_FRONT_CONTACT['450'];
        return localZ >= towDeckPosition(this.bike.id) &&
          localZ + front.axle - front.radius <= TOW_RAMP.rearZ &&
          Math.abs(this.x - (o.lane * LANE + o.offsetX)) <= TRAFFIC_SHAPES.towtruck.contactHalfWidth;
      });
      if (ramp) {
        if (this.lane !== ramp.lane) queuedTowLane = this.lane;
        this.lane = ramp.lane; ramp.rampUsed = true; this.towCarrier = ramp;
        this.velocityY = 0; this.airLaneChangeUsed = false;
        // A single finite impulse at ramp entry; no ongoing forced angle reduction.
        this.rampEntryRemaining = rampEntryImpulse(this.wheelieAngle, this.speed - ramp.velocity);
        this.event = { text: 'RAMPE · JETZT ABSPRINGEN', kind: 'warning', serial: this.event.serial + 1 };
      }
    }
    if (this.towCarrier) {
      const localZ = this.towCarrier.z - (travel - this.towCarrier.velocity * dt);
      // Real relative motion all the way to the cab. No 1.4 s carrier speed lock.
      const pose = towRampPose(this.bike.id, localZ, this.wheelieAngle);
      this.height = pose.height; this.towPitch = pose.pitch; this.velocityY = 0;
      if (queuedTowLane !== null) this.move(queuedTowLane - this.lane);
    } else this.towPitch *= Math.exp(-dt * 8);
    let landedTowJump = false;
    if (!this.towCarrier && (this.height > 0 || this.velocityY > 0)) {
      this.velocityY -= TOW_RAMP.gravity * dt;
      this.height += this.velocityY * dt;
      if (this.height <= 0) {
        this.landingSpeed = Math.abs(this.velocityY); this.landingSerial++;
        this.height = 0; this.velocityY = 0; this.airLaneChangeUsed = false; this.towPitch = 0;
        if (this.towJumpActive) { this.towJumpActive = false; landedTowJump = true; }
      }
    }
    const wasArmed = this.liftArmed;
    let touchdown = 0;
    if (this.towJumpActive) this.airBalance(dt);
    else touchdown = advanceBalance(this, this.balanceProfile, this.speed,
      this.height === 0 || this.onTowTruck ? this.throttleInput : 0, this.forwardInput, dt);
    if (this.onTowTruck) {
      const reaction = consumeRampImpulse(this.rampEntryRemaining, dt);
      this.rampEntryRemaining = reaction.remaining;
      this.wheelieAngularVelocity -= reaction.applied;
    } else this.rampEntryRemaining = 0;
    if (wasArmed && !this.liftArmed) this.wheelieLaunchSerial++;
    if (touchdown > 0.4) { this.landingSerial++; this.landingSpeed = touchdown * 2; }
    if (this.wheelieAngle >= this.balanceProfile.crashAngle) {
      this.crash('Overrotated the wheelie'); return;
    }
    if (this.towCarrier) {
      const pose = towRampPose(this.bike.id,
        this.towCarrier.z - (travel - this.towCarrier.velocity * dt), this.wheelieAngle);
      this.height = pose.height; this.towPitch = pose.pitch;
    }
    this.wheelie = this.wheelieAngle > 0.12 && (this.height === 0 || this.onTowTruck || this.towJumpActive);
    const scrape = tailScrape(this.bike.id, this.wheelieAngle, this.balanceProfile);
    this.scrapeIntensity = this.wheelie && this.height === 0 ? scrape.intensity : 0;
    this.scrapeMaterial = this.scrapeIntensity > 0 ? scrape.material : null;
    if (this.scrapeIntensity > 0) {
      this.scrapeMeters += travel; this.score += travel * 5 * this.scrapeIntensity * this.combo;
      if (this.scrapeMeters >= 7) { this.scrapeMeters = 0; this.skill('TAIL SCRAPE', 100); }
    } else this.scrapeMeters = 0;
    this.balanceQuality = this.wheelie ? balanceAccuracy(this, this.balanceProfile) : 0;
    if (this.wheelie) {
      this.wheelieMeters += travel; this.balancedSeconds += dt * this.balanceQuality;
      this.wheelieChain += travel * this.balanceQuality;
      const durationBonus = 1 + Math.min(1, this.balancedSeconds / 6);
      this.score += travel * 6 * wheelieScoreFactor(this, this.balanceProfile) * durationBonus * (this.speed / 22) * this.combo;
      if (this.wheelieChain >= 20) { this.wheelieChain -= 20; this.skill('BALANCED', 45); }
    } else { this.wheelieChain = 0; this.balancedSeconds = 0; }
    this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 1;
    this.spawnIn -= travel;
    for (const o of this.obstacles) {
      if (!o.active) continue;
      const prev = o.z; o.z -= travel - o.velocity * dt;
      const dx = Math.abs(this.x - (o.lane * LANE + o.offsetX));
      const road = isRoadEvent(o.kind) ? ROAD_EVENTS[o.kind] : undefined;
      const traffic = !isRoadEvent(o.kind) ? TRAFFIC_SHAPES[o.kind] : undefined;
      const length = road?.contactHalfLength ?? traffic!.contactHalfLength;
      if (o === this.towCarrier) {
        if (this.cabContact(o.z)) { this.crash('Missed the side jump'); break; }
        continue;
      }
      const rearContact = traffic ? traffic.rearZ + 1 : length;
      const frontContact = traffic ? traffic.frontZ - 1 : -length;
      const overlap = o.z < rearContact && prev > frontContact;
      const contactWidth = road?.contactHalfWidth ?? traffic!.contactHalfWidth;
      if (!overlap || dx >= contactWidth) this.towSafeObstacles.delete(o);
      const top = o.kind === 'towtruck' && o.z > TOW_RAMP.cabRearZ
        ? o.z > TOW_RAMP.frontZ ? towRampHeight(o.z) : TOW_RAMP.frontHeight
        : (road?.height ?? traffic!.height);
      if (this.towJumpActive && o.kind === 'car' && overlap && dx < contactWidth && this.height >= top + 0.08) {
        o.cleared = true; o.rewardPoints = 180; o.rewardText = 'AUTO UEBERSPRUNG';
      }
      if (overlap && this.height < top && !this.towSafeObstacles.has(o)) {
        const gap = dx - contactWidth;
        if (gap < 0) {
          if (isRoadEvent(o.kind)) {
            if (!o.cleared) {
              const response = roadResponse(o.kind, this.bike.id, this.wheelieAngle, this.forwardLoad);
              if (response.crash) { this.crash(response.crash); break; }
              o.cleared = true; o.rewardPoints = response.rewardPoints; o.rewardText = response.rewardText;
              this.roadRoughness = Math.max(this.roadRoughness, response.roughness);
              this.surfaceGrip = Math.min(this.surfaceGrip, response.grip);
            }
          } else { this.crash(o.kind === 'construction' ? 'Construction barrier collision' : 'Traffic collision'); break; }
        } else o.closest = Math.min(o.closest, gap);
      }
      if (!o.passed && o.z < frontContact) {
        o.passed = true;
        if (o.cleared && o.rewardPoints > 0) this.skill(o.rewardText, o.rewardPoints);
        else if ((!road || o.kind === 'barrier') && o.closest < 0.6) { this.nearMisses++; this.skill('NEAR MISS', 150); }
      }
      if (o.z < -18) o.active = false;
    }
    if (landedTowJump && this.phase === 'playing') { this.jumps++; this.skill('TOW TRUCK TRANSFER', 350); }
    if (this.phase === 'playing') for (const sign of this.signs) {
      if (!sign.active) continue;
      const before = sign.z; sign.z -= travel;
      if (sign.z < 1.2 && before > -1.2 && Math.abs(this.x - sign.lane * LANE) < 0.9 && this.height < 2.1) {
        sign.active = false;
        if (this.collectedSigns & signBit(sign.id)) continue;
        this.lastSignId = sign.id; this.signPickupSerial++; this.collectedSigns |= signBit(sign.id);
        if (this.collectedSigns === COMPLETE_SIGN_MASK && this.signSetCount === 0) {
          this.signSetCount = 1;
          for (const pending of this.signs) pending.active = false;
          this.skill('PFUSCH SET COMPLETE', 750);
        } else this.skill(`SIGN · ${sign.id}`, 45);
      } else if (sign.z < -12) {
        sign.active = false;
        // Prioritise a missed letter at the next safe wave, not six letters later.
        this.signSequence = SIGN_IDS.indexOf(sign.id);
        this.nextSignAttempt = Math.min(this.nextSignAttempt, this.distance + SIGN_RETRY_DISTANCE);
      }
    }
    if (this.phase === 'playing' && this.spawnIn <= 0) this.spawnWave();
  }
  stats(): RunStats { return { id: this.id, score: Math.floor(this.score), distance: Math.floor(this.distance),
    seconds: Math.floor(this.elapsed), bestCombo: this.bestCombo, nearMisses: this.nearMisses, jumps: this.jumps,
    wheelieMeters: Math.floor(this.wheelieMeters), maxSpeed: Math.round(this.maxSpeed * 3.6),
    cause: this.event.kind === 'crash' ? this.event.text : 'Ride ended' }; }
}
