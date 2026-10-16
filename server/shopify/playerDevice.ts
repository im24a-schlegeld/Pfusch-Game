import type { Settings } from '../../app/domain/types.js';

/** Coarse, advisory last-save category only. Never persist headers or use it for authorization. */
export function classifySaveDevice(userAgent?: string, mobileHint?: string): NonNullable<Settings['deviceType']> {
  const ua = (userAgent ?? '').slice(0, 1024);
  if (/bot|crawler|spider/i.test(ua)) return 'unknown';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || /Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (mobileHint === '?1' || /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile';
  if (/Windows NT|Macintosh|X11|CrOS|Linux/i.test(ua)) return 'desktop';
  return 'unknown';
}
