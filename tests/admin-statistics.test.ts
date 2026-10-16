import { describe, expect, it } from 'vitest';
import { newPlayer } from '../app/domain/progression';
import { decodePlayer } from '../app/services';
import { savedPlayerStatistics } from '../server/oxygen/adminStatistics';
import { classifySaveDevice } from '../server/shopify/playerDevice';
import { sanitizeDigitalPlayer } from '../server/shopify/playerValidation';

describe('bounded saved-state statistics', () => {
  it('counts one state per customer, uses XP for level, and keeps missing/forged categories unknown', () => {
    const stats = savedPlayerStatistics([
      { ...newPlayer(), level: 99, settings: { deviceType: 'mobile', touchControls: 'buttons', muted: true } },
      { settings: { deviceType: '<script>', touchControls: 'keyboard', muted: 'yes' }, coins: -1 },
      {},
    ]);
    const rows = (id: string) => stats.find(topic => topic.id === id)!.rows;
    expect(rows('device')).toEqual([{ label: 'Smartphone', count: 1 }, { label: 'Unbekannt', count: 2 }]);
    expect(rows('controls')).toEqual([{ label: 'Tasten', count: 1 }, { label: 'Unbekannt', count: 2 }]);
    expect(rows('level')).toEqual([{ label: '1–3', count: 1 }, { label: 'Unbekannt', count: 2 }]);
    expect(rows('muted')).toEqual([{ label: 'Ja', count: 1 }, { label: 'Unbekannt', count: 2 }]);
    expect(JSON.stringify(stats)).not.toContain('<script>');
    expect(savedPlayerStatistics(Array.from({ length: 100 }, () => ({})))[0].rows).toEqual([{ label: 'Unbekannt', count: 25 }]);
    expect(savedPlayerStatistics([]).every(topic => topic.rows.length === 0)).toBe(true);
  });
  it('migrates absent schema-1 metadata without inventing a device and rejects corrupt save metadata', () => {
    const player = newPlayer();
    expect(decodePlayer(JSON.stringify(player)).settings.deviceType).toBeUndefined();
    expect(sanitizeDigitalPlayer(player, '123').settings.deviceType).toBeUndefined();
    for (const deviceType of ['mobile', 'tablet', 'desktop', 'unknown'] as const) {
      const saved = { ...player, settings: { ...player.settings, deviceType } };
      expect(decodePlayer(JSON.stringify(saved)).settings.deviceType).toBe(deviceType);
      expect(sanitizeDigitalPlayer(saved, '123').settings.deviceType).toBe(deviceType);
    }
    for (const deviceType of ['television', null, ['mobile'], {}]) {
      const saved = { ...player, settings: { ...player.settings, deviceType } };
      expect(decodePlayer(JSON.stringify(saved)).settings.deviceType).toBeUndefined();
      expect(() => sanitizeDigitalPlayer(saved, '123')).toThrow();
    }
  });
  it('classifies coarse HTTP categories without retaining a raw identifier', () => {
    expect(classifySaveDevice('Mozilla iPhone Mobile')).toBe('mobile');
    expect(classifySaveDevice('Mozilla Android Mobile')).toBe('mobile');
    expect(classifySaveDevice('Mozilla iPad')).toBe('tablet');
    expect(classifySaveDevice('Mozilla Android')).toBe('tablet');
    expect(classifySaveDevice('Mozilla Windows NT 10.0')).toBe('desktop');
    expect(classifySaveDevice('', '?1')).toBe('mobile');
    expect(classifySaveDevice(undefined, '?0')).toBe('unknown');
    expect(classifySaveDevice('Googlebot Linux')).toBe('unknown');
    expect(classifySaveDevice('unrecognized')).toBe('unknown');
  });
});
