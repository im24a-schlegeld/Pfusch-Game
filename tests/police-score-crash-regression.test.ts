import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Engine } from '../app/game/engine';
import RideHud from '../app/ui/RideHud';
import { shouldFreezeCrashTraffic } from '../app/game/crashTraffic';

const hud = (score: number, policeChase = false) => renderToStaticMarkup(createElement(RideHud, {
  engine: { score, distance: 0, speed: 0, phase: 'ready', policeChase,
    policeVehicle: { phase: policeChase ? 'chasing' : 'idle' }, policeRamRemaining: 7,
  } as unknown as Engine,
  best: 0, pause: () => {}, dailySignMask: 0,
}));

// React escapes the Swiss grouping apostrophe in HTML (e.g. 123&#x27;456).
// Compare the displayed characters, not an HTML entity's transport encoding.
const decodeScoreMarkup = (html: string) => html
  .replace(/&#(?:x27|39);|&apos;|&#8217;|&rsquo;|’/gi, "'");

describe('score and police HUD regressions', () => {
  it('renders the entire six-digit score including separator', () => {
    const html = hud(123456);
    expect(decodeScoreMarkup(html)).toContain("123'456");
    expect(html).toContain('data-digits="7"');
  });
  it('supports larger scores without truncating the number in markup', () => {
    const html = hud(123456789);
    expect(decodeScoreMarkup(html)).toContain("123'456'789");
    expect(html).toContain('data-digits="11"');
  });
  it('decodes React HTML entities without modifying the game score', () => {
    expect(decodeScoreMarkup('123&#x27;456')).toBe("123'456");
    expect(decodeScoreMarkup('123&#39;456&#39;789')).toBe("123'456'789");
    expect(decodeScoreMarkup('123’456')).toBe("123'456");
  });
  it('preserves police alert, countdown and the two blinking glow elements', () => {
    const html = hud(1000, true);
    expect(html).toContain('HÄNGE SIE AB');
    expect(html).toContain('RAMMEN IN 7 S');
    expect(html).toContain('police-lights');
  });
  it('extends the glow upwards only in button control mode while anchoring its bottom', () => {
    const css = readFileSync(new URL('../app/ride-fix-v42.css', import.meta.url), 'utf8');
    expect(css).toContain(".ride-screen[data-touch-controls='buttons'] .police-lights");
    expect(css).toContain('bottom: 0 !important');
    expect(css).toContain('height: min(65vh, 540px)');
    expect(css).toContain('container-type: inline-size');
  });
});

describe('nearby traffic during a fall', () => {
  it('does not screen-freeze an unrelated parked car', () => {
    expect(shouldFreezeCrashTraffic({ kind: 'car', velocity: 0 }, false)).toBe(false);
  });
  it('does not screen-freeze nearby construction traffic', () => {
    expect(shouldFreezeCrashTraffic({ kind: 'construction', velocity: 0 }, false)).toBe(false);
  });
  it('still freezes the actual impact vehicle for crash contacts', () => {
    expect(shouldFreezeCrashTraffic({ kind: 'car', velocity: 0 }, true)).toBe(true);
    expect(shouldFreezeCrashTraffic({ kind: 'construction', velocity: 0 }, true)).toBe(true);
  });
  it('retains motion-collision behavior for moving surrounding cars', () => {
    expect(shouldFreezeCrashTraffic({ kind: 'car', velocity: 10 }, false)).toBe(true);
    expect(shouldFreezeCrashTraffic({ kind: 'car', velocity: -7 }, false)).toBe(true);
  });
});
