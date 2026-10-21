import { afterEach, describe, expect, it, vi } from 'vitest';
import catalog from '../public/catalog/products.json';
import audit from '../public/catalog/garment-textures.json';
import { newPlayer } from '../app/domain/progression';
import type { Product } from '../app/domain/types';

function imageEnvironment(fails: (url: string, attempt: number) => boolean | 'stall') {
  const requests = new Map<string, number>();
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      const attempt = (requests.get(url) ?? 0) + 1;
      requests.set(url, attempt);
      const failure = fails(url, attempt);
      if (failure !== 'stall') setTimeout(() => { if (failure) this.onerror?.(); else this.onload?.(); }, 0);
    }
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const context = {
        fillStyle: '', fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
        save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
        createPattern: vi.fn(() => ({})),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(150) }),
      };
      return { width: 0, height: 0, context, getContext: () => context };
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return requests;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('3D garment artwork loading', () => {
  it.each(['error', 'stall'] as const)('recovers the same garment after an image %s without rebuilding the preview', async failure => {
    vi.resetModules(); vi.useFakeTimers();
    const failedSource = audit.products['signs-hoodie'].front.sourcesByColor[0].localImage;
    const requests = imageEnvironment((url, attempt) => url === failedSource && attempt === 1 ? (failure === 'stall' ? 'stall' : true) : false);
    const { garmentMaterial } = await import('../app/game/garmentTexture');
    const product = (catalog as Product[]).find(item => item.handle === 'signs-hoodie')!;
    const material = garmentMaterial(product, newPlayer(), '#222222');
    const texture = material.map!;
    await vi.runAllTimersAsync();
    const canvas = texture.image as { context: { drawImage: ReturnType<typeof vi.fn> } };
    expect(requests.get(failedSource)).toBe(2);
    expect(canvas.context.drawImage).toHaveBeenCalledTimes(2);
    expect(material.map).toBe(texture);
    expect(texture.version).toBeGreaterThan(1);
    material.dispose();
  });

  it('still paints both real prints if the optional fabric photograph cannot load', async () => {
    vi.resetModules(); vi.useFakeTimers();
    const unavailable = '/fixture-unavailable-fabric.webp';
    const requests = imageEnvironment(url => url === unavailable);
    const { garmentMaterial } = await import('../app/game/garmentTexture');
    const product = structuredClone((catalog as Product[]).find(item => item.handle === 'signs-hoodie')!);
    product.preview!.colors[0].front!.localImage = unavailable;
    const material = garmentMaterial(product, newPlayer(), '#222222');
    await vi.runAllTimersAsync();
    const canvas = material.map!.image as { context: { drawImage: ReturnType<typeof vi.fn> } };
    expect(canvas.context.drawImage).toHaveBeenCalledTimes(2);
    expect(requests.get(unavailable)).toBe(3);
    material.dispose();
  });
});
