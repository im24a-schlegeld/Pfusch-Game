import { BIKES } from '../../app/domain/config.js';
import { levelForXp } from '../../app/domain/progression.js';
import { isRecord } from '../shopify/playerValidation.js';

export interface StatisticsTopic {
  id: string;
  label: string;
  rows: { label: string; count: number }[];
}
const unknown = 'Unbekannt';
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const choice = (value: unknown, choices: Record<string, string>) => typeof value === 'string' && Object.hasOwn(choices, value) ? choices[value] : unknown;
const boolean = (value: unknown) => value === true ? 'Ja' : value === false ? 'Nein' : unknown;
function bucket(value: unknown, thresholds: number[], labels: string[]) {
  if (!validNumber(value)) return unknown;
  return labels[thresholds.findIndex(limit => value < limit)] ?? labels[labels.length - 1];
}

/** One latest saved state per sampled customer; no identifiers, sessions or inferred history. */
export function savedPlayerStatistics(players: Record<string, unknown>[]): StatisticsTopic[] {
  const topics: { id: string; label: string; read: (p: Record<string, unknown>, s: Record<string, unknown>) => string }[] = [
    { id: 'device', label: 'Gerät beim letzten Speichern', read: (_p, s) => choice(s.deviceType, { mobile: 'Smartphone', tablet: 'Tablet', desktop: 'Desktop', unknown }) },
    { id: 'controls', label: 'Touch-Steuerung', read: (_p, s) => choice(s.touchControls, { swipe: 'Wischen', buttons: 'Tasten' }) },
    { id: 'quality', label: 'Grafikqualität', read: (_p, s) => choice(s.quality, { auto: 'Automatisch', low: 'Niedrig' }) },
    { id: 'motion', label: 'Bewegung reduziert', read: (_p, s) => boolean(s.reducedMotion) },
    { id: 'muted', label: 'Ton stumm', read: (_p, s) => boolean(s.muted) },
    { id: 'tutorial', label: 'Einführung gesehen', read: (_p, s) => boolean(s.tutorialSeen) },
    { id: 'bike', label: 'Ausgewähltes Motorrad', read: p => choice(p.bike, Object.fromEntries(BIKES.map(bike => [bike.id, bike.name]))) },
    { id: 'helmet', label: 'Ausgewählter Helm', read: p => choice(p.helmet, { fullface: 'Integralhelm', motocross: 'Motocross' }) },
    { id: 'level', label: 'Level (aus XP)', read: p => validNumber(p.xp) ? bucket(levelForXp(p.xp), [4, 7], ['1–3', '4–6', '7+']) : unknown },
    { id: 'coins', label: 'Coin-Guthaben', read: p => bucket(p.coins, [1000, 10000], ['0–999', '1.000–9.999', '10.000+']) },
    { id: 'runs', label: 'Gespeicherte Fahrten', read: p => bucket(p.runsPlayed, [1, 10, 100], ['0', '1–9', '10–99', '100+']) },
  ];
  return topics.map(topic => {
    const counts = new Map<string, number>();
    for (const player of players.slice(0, 25)) {
      const label = topic.read(player, isRecord(player.settings) ? player.settings : {});
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return { id: topic.id, label: topic.label, rows: [...counts].map(([label, count]) => ({ label, count })) };
  });
}
