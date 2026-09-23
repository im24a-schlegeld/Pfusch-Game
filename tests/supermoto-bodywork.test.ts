import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { makeBike } from '../app/game/vehicle';
import { newPlayer } from '../app/domain/progression';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('reference Supermoto bodywork', () => {
  let bike: ReturnType<typeof makeBike>;
  beforeAll(() => {
    bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
  }, 30000);

  it('uses thin closed moulded plastic instead of bulky elliptical solids', () => {
    for (const name of ['supermoto-front-fender', 'supermoto-tail-fender', 'supermoto-headlight-mask']) {
      const part = bike.body.getObjectByName(name) as Mesh;
      const p = part.geometry.getAttribute('position'), face = p.count / 2;
      for (let i = 0; i < face; i++) {
        const front = new Vector3().fromBufferAttribute(p, i);
        const back = new Vector3().fromBufferAttribute(p, i + face);
        expect(front.distanceTo(back)).toBeCloseTo(name === 'supermoto-tail-fender' ? 0.007 : 0.004, 6);
      }
      expect(part.geometry.index!.count).toBeGreaterThan((face - 1) * 6);
    }
    for (const name of ['radiator-shroud', 'supermoto-side-cover']) {
      const panels = bike.body.getObjectsByProperty('name', name) as Mesh[];
      expect(panels).toHaveLength(2);
      for (const panel of panels) {
        const p = panel.geometry.getAttribute('position');
        for (let i = 0; i < p.count / 2; i++) {
          expect(Math.abs(p.getX(i) - p.getX(i + p.count / 2))).toBeCloseTo(0.004, 6);
        }
      }
    }
  });

  it('mounts the actual rear damper at 45 degrees leaning toward the steering head', () => {
    const damper = bike.body.getObjectByName('supermoto-shock-damper') as Mesh;
    const axis = new Vector3(0, 1, 0).applyQuaternion(damper.quaternion);
    expect(Math.abs(axis.x)).toBeLessThan(1e-6);
    expect(Math.abs(axis.y)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(axis.z)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(axis.y * axis.z).toBeLessThan(0);
    expect(bike.body.getObjectsByProperty('name', 'supermoto-shock-eyelet')).toHaveLength(2);
    expect(bike.body.getObjectsByProperty('name', 'supermoto-shock-spring-seat')).toHaveLength(2);
  });

  it('keeps the visible tank black and the rear blade above its tyre without a plate carrier', () => {
    const tank = bike.body.getObjectByName('supermoto-fuel-tank') as Mesh;
    expect((tank.material as MeshStandardMaterial).color.getHexString()).toBe('101214');
    // Several samples of the round black volume must remain visible between
    // the upper crown and side-plastic seams, rather than hiding the whole tank.
    const shells = ['supermoto-fuel-tank', 'radiator-shroud', 'shroud-shoulder',
      'supermoto-side-cover', 'supermoto-airbox-access-panel', 'supermoto-airbox', 'supermoto-seat']
      .flatMap(name => bike.body.getObjectsByProperty('name', name));
    let tankSamples = 0;
    for (let y = 0.86; y <= 1.02; y += 0.02) for (let z = -0.34; z < 0.16; z += 0.025) {
      const start = bike.body.localToWorld(new Vector3(0.8, y, z));
      const hit = new Raycaster(start, new Vector3(-1, 0, 0)).intersectObjects(shells, false)[0];
      if (hit?.object === tank) tankSamples++;
    }
    expect(tankSamples).toBeGreaterThan(5);
    const tail = bike.body.getObjectByName('supermoto-tail-fender') as Mesh;
    const bounds = new Box3().setFromObject(tail);
    const wheelBounds = new Box3().setFromObject(bike.wheels[1]);
    expect(bounds.min.y).toBeGreaterThan(wheelBounds.max.y + 0.05);
    expect(bike.body.getObjectByName('supermoto-tail-light-lens')).toBeDefined();
    expect(bike.body.getObjectByName('supermoto-number-plate-carrier')).toBeUndefined();
  });
});
