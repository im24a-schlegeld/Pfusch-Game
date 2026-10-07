import { BIKES } from '../domain/config';
import { Engine, STEP, type EngineInput } from './engine';

export const MAX_VERIFIED_TICKS = 18000;
export const MAX_VERIFIED_EVENTS = 2000;
export interface VerifiedRunChallenge {
  version: 1;
  runId: string;
  seed: number;
  bikeId: string;
  startedAt: number;
  expiresAt: number;
  token: string;
}
export interface VerifiedRunEvent { tick: number; input: EngineInput }
export interface VerifiedRunProof { ticks: number; events: VerifiedRunEvent[] }
export interface VerifiedRunSubmission { token: string; proof: VerifiedRunProof }

/** Records domain commands only. No score, wallet or browser identity is evidence. */
export class VerifiedRunRecorder {
  private events: VerifiedRunEvent[] = [];
  private overflow = false;
  constructor(private engine: Engine) {
    engine.onInput = (input, tick) => {
      if (this.overflow) return;
      if (tick > MAX_VERIFIED_TICKS) return;
      if (this.events.length >= MAX_VERIFIED_EVENTS) {
        this.overflow = true;
        this.events = [];
        return;
      }
      this.events.push({ tick, input });
    };
  }
  proof(): VerifiedRunProof | null {
    if (this.overflow) return null;
    return { ticks: Math.min(this.engine.fixedTicks, MAX_VERIFIED_TICKS), events: [...this.events] };
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function input(value: unknown): value is EngineInput {
  if (!record(value) || typeof value.type !== 'string') return false;
  if (value.type === 'clear' || value.type === 'end') return Object.keys(value).length === 1;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'value')) return false;
  if (value.type === 'hold' || value.type === 'forward') return typeof value.value === 'boolean';
  if (value.type === 'move') return value.value === -1 || value.value === 1;
  return value.type === 'weight' && typeof value.value === 'number' && Number.isFinite(value.value)
    && value.value >= -1 && value.value <= 1;
}

/** Server calls this with its signed seed/bike. Input schemas and work are bounded. */
export function replayVerifiedRun(bikeId: string, seed: number, proof: unknown): { score: number; ticks: number; crashed: boolean } | null {
  const bike = BIKES.find(item => item.id === bikeId);
  if (!bike || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !record(proof)
    || !Number.isInteger(proof.ticks) || typeof proof.ticks !== 'number' || proof.ticks < 0 || proof.ticks > MAX_VERIFIED_TICKS
    || !Array.isArray(proof.events) || proof.events.length > MAX_VERIFIED_EVENTS
    || Object.keys(proof).some(key => key !== 'ticks' && key !== 'events')) return null;
  const events: VerifiedRunEvent[] = [];
  let previous = 0;
  let eventsAtTick = 0;
  let lastMove = -6;
  for (const event of proof.events) {
    if (!record(event) || Object.keys(event).length !== 2 || !Number.isInteger(event.tick)
      || typeof event.tick !== 'number' || event.tick < previous || event.tick > proof.ticks || !input(event.input)) return null;
    eventsAtTick = event.tick === previous ? eventsAtTick + 1 : 1;
    if (eventsAtTick > 8) return null;
    if (event.input.type === 'move') {
      if (event.tick - lastMove < 6) return null;
      lastMove = event.tick;
    }
    previous = event.tick;
    events.push({ tick: event.tick, input: event.input });
  }
  const engine = new Engine(bike, seed);
  engine.start();
  let eventIndex = 0;
  for (let tick = 0; tick <= proof.ticks; tick++) {
    while (eventIndex < events.length && events[eventIndex].tick === tick) {
      const command = events[eventIndex++].input;
      if (engine.phase === 'crashed' && command.type !== 'clear') return null;
      switch (command.type) {
        case 'move': engine.move(command.value); break;
        case 'hold': engine.hold(command.value); break;
        case 'forward': engine.forward(command.value); break;
        case 'weight': engine.weight(command.value); break;
        case 'clear': engine.clearInput(); break;
        case 'end': engine.endRide(); break;
      }
    }
    if (tick === proof.ticks) break;
    if (engine.phase !== 'playing') return null;
    engine.advance(STEP);
  }
  return { score: engine.stats().score, ticks: engine.fixedTicks, crashed: engine.phase === 'crashed' };
}
