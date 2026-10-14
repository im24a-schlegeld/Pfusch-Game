import { expect, it } from 'vitest';
import { InstancedMesh, Raycaster, Scene, Vector3 } from 'three';
import { BIKES } from '../app/domain/config';
import { World, type WorldSegment } from '../app/game/world';
import { makeWorldView } from '../app/game/worldView';

const pace = BIKES.find(bike => bike.id === '701')!;
function findTunnel(style: 'modern' | 'weathered') {
  const world = new World(523, pace);
  for (let distance = 0; distance < 60000; distance += 100) {
    world.advance(distance);
    const segment = world.segments.find(segment => segment.tunnel?.style === style);
    if (segment) return segment;
  }
  throw new Error(`Missing seeded ${style} tunnel`);
}

it.each((['modern', 'weathered'] as const).flatMap(style => [false, true].map(low => ({ style, low }))))(
  'keeps $style body caps from competing with either real portal (low=$low)', ({ style, low }) => {
    const segment: WorldSegment = findTunnel(style);
    for (const boundary of [segment.start, segment.end]) {
      const entry = boundary === segment.start, outside = entry ? 1 : -1;
      const distance = boundary - outside * 3;
      const world = new World(523, pace); world.advance(distance);
      const scene = new Scene(), view = makeWorldView(scene, low);
      view.update(world, distance); scene.updateMatrixWorld(true);
      expect(view.root.children).toHaveLength(56);
      const bodyRoof = view.root.getObjectByName(`world-arch-tunnel${style === 'modern' ? 'Modern' : 'Weathered'}`) as InstancedMesh;
      const bodyWall = view.root.getObjectByName(`world-box-tunnel${style === 'modern' ? 'Modern' : 'Weathered'}`) as InstancedMesh;
      const portalRoof = view.root.getObjectByName('world-arch-concrete') as InstancedMesh;
      const portalWall = view.root.getObjectByName('world-box-concrete') as InstancedMesh;
      // Real rays through the roof ring / support overlap used to hit two
      // differently painted cap triangles at exactly the same portal depth.
      for (const [x, y, body, portal] of [[2, 7.9, bodyRoof, portalRoof], [6.65, 1.9, bodyWall, portalWall]] as const) {
        const ray = new Raycaster(new Vector3(x, y, distance - boundary + outside * 3), new Vector3(0, 0, -outside));
        const atMouth = (mesh: InstancedMesh) => ray.intersectObject(mesh, false)
          .filter(hit => Math.abs(hit.distance - 3) < 0.0001);
        expect(atMouth(portal).length).toBeGreaterThan(0);
        expect(atMouth(body)).toEqual([]);
      }
      expect(bodyRoof.geometry).not.toBe(portalRoof.geometry);
      expect(bodyWall.geometry).not.toBe(portalWall.geometry);
      expect(bodyWall.geometry.getAttribute('cartoonBox').getW(0)).toBe(1);
      // Geometry remains owned by source pools, which the scene cleanup can
      // discover. Concrete portals and visible weathered ribs stay capped.
      const owned = new Set<unknown>();
      scene.traverse(object => { if (object instanceof InstancedMesh) owned.add(object.geometry); });
      expect(owned.has(bodyRoof.geometry)).toBe(true);
      expect(owned.has(bodyWall.geometry)).toBe(true);
      const rib = view.root.getObjectByName('world-arch-dark') as InstancedMesh;
      expect(rib.geometry).toBe(portalRoof.geometry);
      view.dispose();
    }
  },
);
