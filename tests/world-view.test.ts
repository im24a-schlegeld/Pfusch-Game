import { describe, expect, it } from 'vitest';
import {
  Box3,
  InstancedMesh,
  Matrix4,
  Raycaster,
  Scene,
  Triangle,
  Vector3,
} from 'three';
import { BIKES } from '../app/domain/config';
import { World, type WorldSegment } from '../app/game/world';
import { makeWorldView, WORLD_VIEW } from '../app/game/worldView';

const seed = 523;
const pace = BIKES.find((bike) => bike.id === '701')!;
const tolerance = 0.0001;

function findSegment(predicate: (segment: WorldSegment) => boolean) {
  const world = new World(seed, pace);
  for (let distance = 0; distance < 60000; distance += 100) {
    world.advance(distance);
    const segment = world.segments.find(predicate);
    if (segment) return segment;
  }
  throw new Error('The seeded route did not contain the required environment.');
}

function render(distance: number, low = false) {
  const world = new World(seed, pace);
  world.advance(distance);
  const view = makeWorldView(new Scene(), low);
  view.update(world, distance);
  view.root.updateMatrixWorld(true);
  return { world, view, distance };
}

/** Actual geometry extents after each instance and the moving root transform. */
function instanceBounds(mesh: InstancedMesh) {
  mesh.geometry.computeBoundingBox();
  const matrix = new Matrix4();
  return Array.from({ length: mesh.count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    matrix.premultiply(mesh.matrixWorld);
    return mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
  });
}

function bounds(
  rendered: ReturnType<typeof render>,
  name: string,
  filter: (box: Box3) => boolean = () => true,
) {
  return instanceBounds(
    rendered.view.root.getObjectByName(name) as InstancedMesh,
  )
    .filter(filter)
    .map((box) => ({
      box,
      start: rendered.distance - box.max.z,
      end: rendered.distance - box.min.z,
    }));
}

/** Detects holes, overlaps, and geometry escaping a logical segment boundary. */
function coversExactly(
  spans: { start: number; end: number }[],
  start: number,
  end: number,
) {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  expect(ordered.length).toBeGreaterThan(0);
  let previous = start;
  for (const span of ordered) {
    expect(Math.abs(span.start - previous)).toBeLessThan(tolerance);
    expect(span.end).toBeGreaterThan(span.start);
    previous = span.end;
  }
  expect(Math.abs(previous - end)).toBeLessThan(tolerance);
}

function visibleInterval(
  rendered: ReturnType<typeof render>,
  segment: WorldSegment,
) {
  return [
    Math.max(segment.start, rendered.view.root.userData.windowStart as number),
    Math.min(segment.end, rendered.view.root.userData.windowEnd as number),
  ] as const;
}

/** Check complete rendered triangles, including caps that might bridge a mouth. */
function terrainRoadIntersections(rendered: ReturnType<typeof render>) {
  const road = new Box3(
    new Vector3(
      -4.8,
      -0.009,
      rendered.distance - (rendered.view.root.userData.windowEnd as number),
    ),
    new Vector3(
      4.8,
      4,
      rendered.distance - (rendered.view.root.userData.windowStart as number),
    ),
  );
  const hits: string[] = [];
  const matrix = new Matrix4(),
    triangle = new Triangle();
  for (const mesh of rendered.view.root.children as InstancedMesh[]) {
    if (!/-(soil|sand|grass)$/.test(mesh.name)) continue;
    const position = mesh.geometry.getAttribute('position'),
      index = mesh.geometry.index;
    const count = index?.count ?? position.count;
    for (let instance = 0; instance < mesh.count; instance++) {
      mesh.getMatrixAt(instance, matrix);
      matrix.premultiply(mesh.matrixWorld);
      for (let i = 0; i < count; i += 3) {
        triangle.a
          .fromBufferAttribute(position, index ? index.getX(i) : i)
          .applyMatrix4(matrix);
        triangle.b
          .fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1)
          .applyMatrix4(matrix);
        triangle.c
          .fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2)
          .applyMatrix4(matrix);
        if (road.intersectsTriangle(triangle))
          hits.push(`${mesh.name}:${instance}:${i / 3}`);
      }
    }
  }
  return hits;
}

describe('streamed world geometry', () => {
  it.each(
    (['modern', 'weathered'] as const).flatMap((style) =>
      [false, true].map((low) => ({ style, low })),
    ),
  )(
    'encloses the $style tunnel and closes its roof and walls at the exact entry and exit (low=$low)',
    ({ style, low }) => {
      const segment = findSegment((s) => s.tunnel?.style === style);
      for (const distance of [segment.start, segment.end]) {
        const rendered = render(distance, low);
        const [start, end] = visibleInterval(rendered, segment);
        const finish = style === 'modern' ? 'tunnelModern' : 'tunnelWeathered';
        coversExactly(bounds(rendered, `world-arch-${finish}`), start, end);
        const mountain = bounds(rendered, 'world-mountain-soil').filter(
          (span) =>
            span.end > segment.start + tolerance &&
            span.start < segment.end - tolerance,
        );
        coversExactly(mountain, start, end);
        for (const { box } of mountain) {
          expect(box.min.x).toBeCloseTo(-35);
          expect(box.max.x).toBeCloseTo(35);
          expect(box.max.y).toBeCloseTo(17.5);
        }
        for (const side of [-1, 1]) {
          const walls = bounds(rendered, `world-box-${finish}`, (box) =>
            side < 0 ? box.max.x < 0 : box.min.x > 0,
          );
          coversExactly(walls, start, end);
          for (const { box } of walls) {
            expect(box.min.y).toBeCloseTo(0);
            expect(box.max.y).toBeCloseTo(4);
          }
        }
        // A ray from the rider's head hits the vaulted ceiling only inside the
        // mouth. This checks the real hollow geometry, not only its outer box.
        const roofs = rendered.view.root.children.filter(
          (mesh) =>
            mesh.name.startsWith('world-arch-') ||
            mesh.name === 'world-mountain-soil',
        );
        for (const [z, enclosed] of [
          [distance - 0.02, distance === segment.end],
          [distance + 0.02, distance === segment.start],
        ] as const) {
          const ray = new Raycaster(
            new Vector3(0, 2, rendered.distance - z),
            new Vector3(0, 1, 0),
            0,
            20,
          );
          expect(ray.intersectObjects(roofs, false).length > 0).toBe(enclosed);
        }
        const portals = bounds(rendered, 'world-arch-concrete');
        for (const portal of portals) {
          expect(portal.start).toBeGreaterThanOrEqual(
            segment.start - tolerance,
          );
          expect(portal.end).toBeLessThanOrEqual(segment.end + tolerance);
        }
        // Both sides meet the same mountain contour at the mouth. Sample
        // actual surfaces just across the boundary, not their broad bounds.
        const terrain = rendered.view.root.children.filter(
          (mesh) =>
            mesh.name === 'world-mountain-soil' ||
            mesh.name === 'world-berm-soil',
        );
        for (const side of [-1, 1]) {
          const heights = [-0.01, 0.01].map((offset) => {
            const hits = new Raycaster(
              new Vector3(side * 10, 25, rendered.distance - distance - offset),
              new Vector3(0, -1, 0),
            ).intersectObjects(terrain, false);
            expect(hits.length).toBeGreaterThan(0);
            return hits[0].point.y;
          });
          expect(Math.abs(heights[0] - heights[1])).toBeLessThan(0.01);
        }
        expect(terrainRoadIntersections(rendered)).toEqual([]);
      }
    },
  );

  it.each([false, true])(
    'keeps visible terrain off asphalt across generated environments (low=%s)',
    (low) => {
      for (const kind of [
        'city',
        'industrial',
        'construction',
        'open',
        'waterfront',
        'tunnel-approach',
        'tunnel-exit',
        'bridge-approach',
        'bridge-exit',
      ] as const) {
        const segment = findSegment((s) => s.kind === kind);
        const rendered = render((segment.start + segment.end) / 2, low);
        expect(terrainRoadIntersections(rendered), kind).toEqual([]);
        // Drainage stays on the sidewalk and follows a stable 24 m cadence.
        const grates = bounds(
          rendered,
          'world-box-dark',
          (box) =>
            Math.abs(box.max.x - box.min.x - 0.3) < tolerance &&
            box.min.y > 0.14 &&
            box.max.y < 0.152,
        );
        for (const { box, start, end } of grates) {
          expect(box.min.x > 4.8 || box.max.x < -4.8).toBe(true);
          const tick = ((start + end) / 2 - 6) / 24;
          expect(Math.abs(tick - Math.round(tick))).toBeLessThan(tolerance);
        }
        expect(grates.length).toBeLessThanOrEqual(24);
        if (!kind.startsWith('tunnel-')) continue;
        const [start, end] = visibleInterval(rendered, segment);
        expect(
          bounds(rendered, 'world-canopy-soil').filter(
            (span) =>
              span.end > start + tolerance && span.start < end - tolerance,
          ),
        ).toHaveLength(0);
        const mesh = rendered.view.root.getObjectByName(
          'world-berm-soil',
        ) as InstancedMesh;
        expect(mesh.material).toHaveProperty('flatShading', true);
        expect(mesh.material).toHaveProperty('vertexColors', true);
        const mountain = rendered.view.root.getObjectByName(
          'world-mountain-soil',
        ) as InstancedMesh;
        const ground = rendered.view.root.getObjectByName(
          'world-box-soil',
        ) as InstancedMesh;
        expect(mesh.material).toBe(mountain.material);
        expect(mesh.material).not.toBe(ground.material);
        expect(ground.material).toHaveProperty('vertexColors', false);
        for (const side of [-1, 1]) {
          const spans = bounds(rendered, mesh.name, (box) =>
            side < 0 ? box.max.x < 0 : box.min.x > 0,
          ).filter(
            (span) =>
              span.end > start + tolerance && span.start < end - tolerance,
          );
          coversExactly(spans, start, end);
          for (const { box } of spans)
            expect(side < 0 ? -box.max.x : box.min.x).toBeGreaterThanOrEqual(
              7.21,
            );
        }
      }
    },
  );

  it.each([0, 1])(
    'supports bridge variant %s with a continuous deck and water at both banks',
    (variant) => {
      const segment = findSegment(
        (s) => s.kind === 'bridge' && s.variant % 2 === variant,
      );
      for (const distance of [segment.start, segment.end]) {
        const rendered = render(distance);
        const [start, end] = visibleInterval(rendered, segment);
        const deck = bounds(rendered, 'world-box-bridgeDeck');
        coversExactly(deck, start, end);
        coversExactly(
          bounds(
            rendered,
            'world-box-water',
            (box) => box.min.x < -119 && box.max.x > 119,
          ),
          start,
          end,
        );
        for (const { box } of deck) {
          expect(box.max.y - box.min.y).toBeGreaterThan(1);
          expect(box.min.x).toBeLessThan(-6);
          expect(box.max.x).toBeGreaterThan(6);
          expect(box.max.y).toBeLessThan(0);
        }
        for (const ground of bounds(rendered, 'world-box-grass')) {
          const intersection =
            Math.min(end, ground.end) - Math.max(start, ground.start);
          expect(intersection).toBeLessThan(tolerance);
        }
      }
    },
  );

  it('fills the water and seawall even in a narrow clipped waterfront cell', () => {
    const segment = findSegment(
      (s) => s.kind === 'waterfront' && s.start % WORLD_VIEW.cellLength > 9,
    );
    const rendered = render(segment.start);
    const [start, end] = visibleInterval(rendered, segment);
    coversExactly(
      bounds(rendered, 'world-box-water', (box) => box.min.y > -2),
      start,
      end,
    );
    coversExactly(
      bounds(
        rendered,
        'world-box-concrete',
        (box) => box.min.x > 6.9 && box.max.x < 7.5 && box.min.y < -1,
      ),
      start,
      end,
    );
  });

  it.each([false, true])(
    'reuses all GPU pools during long travel (low=%s), with no per-frame uploads or duplicate instances',
    (low) => {
      const world = new World(seed, pace);
      const view = makeWorldView(new Scene(), low);
      const pools = view.root.children as InstancedMesh[];
      const resources = pools.map((mesh) => ({
        mesh,
        geometry: mesh.geometry,
        material: mesh.material,
        instanceMatrix: mesh.instanceMatrix,
        buffer: mesh.instanceMatrix.array,
      }));
      const kinds = new Set<string>();
      let peakPoolUsage = 0;
      // Hundreds of cell recycles include both tunnel styles and bridge variants.
      for (let distance = 0; distance <= 36000; distance += 72) {
        world.advance(distance);
        view.update(world, distance);
        for (const segment of world.segments) kinds.add(segment.kind);
        for (const mesh of pools)
          peakPoolUsage = Math.max(
            peakPoolUsage,
            mesh.count / mesh.instanceMatrix.count,
          );
        const versions = pools.map((mesh) => mesh.instanceMatrix.version);
        world.advance(distance + 0.25);
        view.update(world, distance + 0.25);
        expect(pools.map((mesh) => mesh.instanceMatrix.version)).toEqual(
          versions,
        );
        expect(view.root.position.z).toBeCloseTo(0.25);
        if (distance % 3600 !== 0) continue;
        expect(view.root.children).toHaveLength(resources.length);
        for (const resource of resources) {
          const mesh = resource.mesh;
          expect(mesh.geometry).toBe(resource.geometry);
          expect(mesh.material).toBe(resource.material);
          expect(mesh.instanceMatrix).toBe(resource.instanceMatrix);
          expect(mesh.instanceMatrix.array).toBe(resource.buffer);
          expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
          expect(mesh.frustumCulled).toBe(false);
        }
        for (const mesh of pools) {
          const transforms = new Set<string>();
          for (let index = 0; index < mesh.count; index++) {
            const elements = mesh.instanceMatrix.array.subarray(
              index * 16,
              (index + 1) * 16,
            );
            expect([...elements].every(Number.isFinite)).toBe(true);
            transforms.add(elements.join(','));
          }
          expect(transforms.size, mesh.name).toBe(mesh.count);
        }
      }
      expect(peakPoolUsage).toBeGreaterThan(0);
      expect(peakPoolUsage).toBeLessThanOrEqual(1);
      expect(kinds.size).toBe(11);
      // Every batch of the same primitive shares one geometry allocation.
      expect(new Set(pools.map((mesh) => mesh.geometry)).size).toBe(7);
    },
  );
});
