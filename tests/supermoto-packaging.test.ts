import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(),
  fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(),
  accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('EXC central bodywork coverage', () => {
  let bike: ReturnType<typeof makeBike>;
  beforeAll(() => {
    bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
  });

  it('closes the annotated middle opening from either side and both quarter directions', () => {
    const finish = new MeshBasicMaterial({ side: DoubleSide });
    // Exclude the frame, engine and shock: those can interrupt a ray without
    // closing the unwanted view through the tank / number-panel transition.
    const shells = ['supermoto-fuel-tank', 'supermoto-airbox',
      'supermoto-airbox-access-panel', 'supermoto-middle-side-cover',
      'airbox-inner-splash-wall', 'radiator-shroud', 'supermoto-side-cover']
      .flatMap(name => bike.body.getObjectsByProperty('name', name)) as Mesh[];
    const probes = shells.map(part => {
      const probe = new Mesh(part.geometry, finish);
      probe.name = part.name;
      probe.matrixWorld.copy(part.matrixWorld);
      return probe;
    });
    const open: string[] = [];
    try {
      for (const side of [-1, 1]) for (const quarter of [-0.3, 0, 0.3]) {
        for (const z of [-0.03, 0.035, 0.10, 0.165, 0.23]) for (const y of [0.79, 0.83, 0.87]) {
          const outward = new Vector3(side, 0, quarter).normalize();
          const origin = bike.body.localToWorld(new Vector3(side * 0.12, y, z).addScaledVector(outward, 0.6));
          const direction = outward.negate().transformDirection(bike.body.matrixWorld);
          const hits = new Raycaster(origin, direction).intersectObjects(probes, false);
          const local = hits[0] && bike.body.worldToLocal(hits[0].point.clone());
          // An opposite-side panel seen through a hole must not count as the
          // near-side airbox housing. Keep the enclosure outside the centre.
          if (!local || local.x * side < 0.065)
            open.push(`side=${side}, quarter=${quarter}, y=${y}, z=${z}; first=${hits[0]?.object.name ?? 'empty'}`);
        }
      }
      expect(open, 'the central reservoir and backing must close every sampled opening').toEqual([]);
    } finally {
      finish.dispose();
    }
  });
});
