import { describe, expect, it, vi } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { newPlayer } from '../app/domain/progression';
import { makeBike } from '../app/game/vehicle';
import { supermotoSeatGeometry } from '../app/game/supermotoSeat';
import { supermotoSideCoverGeometry } from '../app/game/supermotoBodywork';
import { envelope } from './helpers/solidClearance';

vi.mock('../app/game/garmentTexture', () => ({
  garmentMaterial: () => new MeshStandardMaterial(), fabricMaterial: () => new MeshStandardMaterial(),
  sleeveMaterial: () => new MeshStandardMaterial(), accessoryMaterial: () => new MeshStandardMaterial(),
}));

describe('reference seat wedge and rounded rear shoulder', () => {
  it('retains the central riding surface with a pronounced triangular lower skirt and flatter rear seat', () => {
    const geometry = supermotoSeatGeometry(), material = new MeshBasicMaterial({ side: DoubleSide });
    const seat = new Mesh(geometry, material); seat.updateMatrixWorld(true);
    try {
      for (const [z, top] of [[-0.145, 1.010], [0.040, 0.997], [0.380, 0.993], [0.625, 1.010]]) {
        const hits = new Raycaster(new Vector3(0, 2, z), new Vector3(0, -1, 0)).intersectObject(seat, false);
        expect(hits.length).toBeGreaterThan(1);
        expect(hits[0].point.y, `reference seat upper surface at z=${z}`).toBeCloseTo(top, 6);
      }
      const bottom = (z: number) => new Raycaster(new Vector3(0, 0, z), new Vector3(0, 1, 0))
        .intersectObject(seat, false)[0].point.y;
      expect(bottom(0.380)).toBeCloseTo(0.903, 6);
      expect(bottom(0.220)).toBeLessThan(0.890);
      expect(bottom(-0.145)).toBeGreaterThan(0.963);
      expect(bottom(0.625)).toBeGreaterThan(0.976);
      expect(bottom(0.625) - bottom(0.220), 'rearward side of the V-shaped upholstery').toBeGreaterThan(0.085);
      expect(geometry.boundingBox!.max.x).toBeLessThan(0.102);
      expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
    } finally { material.dispose(); geometry.dispose(); }
  });

  it('turns each actual panel shoulder gradually from the saddle lip down into the broad side face', () => {
    for (const side of [-1, 1]) {
      const geometry = supermotoSideCoverGeometry(side), p = geometry.getAttribute('position');
      const row: Vector3[] = [];
      for (let i = 0; i < p.count / 2; i++) if (Math.abs(p.getZ(i) - 0.345) < 1e-6)
        row.push(new Vector3(Math.abs(p.getX(i)), p.getY(i), p.getZ(i)));
      row.sort((a, b) => b.y - a.y);
      expect(row).toHaveLength(25);
      const angle = (i: number) => Math.atan2(row[i].y - row[i + 1].y, row[i + 1].x - row[i].x);
      expect(angle(0)).toBeLessThan(Math.PI / 4);
      expect(angle(7)).toBeGreaterThan(Math.PI / 3);
      expect(row[0].x).toBeLessThan(0.100);
      expect(row[0].y).toBeGreaterThan(0.912);
      expect(row[0].y).toBeLessThan(0.925);
      // The fuller lower bolster surrounds the unchanged rail; the remaining
      // exposed plastic still has a broad, visibly rounded shoulder.
      expect(row[8].x - row[0].x).toBeGreaterThan(0.038);
      geometry.dispose();
    }
  });

  it('aligns the actual tapered rear tip with the rearmost enlarged tyre at neutral sag', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.animateSuspension(0, 0); bike.root.updateMatrixWorld(true);
    const inverse = bike.root.matrixWorld.clone().invert();
    const tire = bike.wheels[1].getObjectByName('tire') as Mesh;
    const tail = bike.body.getObjectByName('supermoto-tail-fender') as Mesh;
    const rear = envelope(tire, inverse), blade = envelope(tail, inverse);
    expect(Math.abs(blade.max.z - rear.max.z), 'blade ends at the rear tyre silhouette, not at its axle').toBeLessThan(0.003);
    const p = tail.geometry.getAttribute('position');
    let lastZ = -Infinity, lastWidth = 0;
    for (let i = 0; i < p.count; i++) lastZ = Math.max(lastZ, p.getZ(i));
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > lastZ - 0.015) lastWidth = Math.max(lastWidth, Math.abs(p.getX(i)));
    expect(lastWidth).toBeLessThan(0.040);
  });

  it('exposes the black upholstery wedge above the joined shoulder, without a white pan lip across it', () => {
    const bike = makeBike({ ...newPlayer(), bike: '450' }, []);
    bike.root.updateMatrixWorld(true);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const probes = ['supermoto-seat', 'supermoto-tail-fender', 'supermoto-side-cover',
      'supermoto-middle-side-cover', 'supermoto-airbox-access-panel', 'supermoto-airbox',
      'supermoto-upper-subframe', 'supermoto-shock-bridge-support']
      .flatMap(name => bike.body.getObjectsByProperty('name', name) as Mesh[]).map(source => {
        const proxy = new Mesh(source.geometry, material); proxy.name = source.name;
        proxy.matrixWorld.copy(source.matrixWorld); return proxy;
      });
    try {
      for (const side of [-1, 1]) for (const z of [0.265, 0.30, 0.345, 0.38]) for (const y of [0.949, 0.957, 0.965]) {
        const ray = new Raycaster(bike.body.localToWorld(new Vector3(side * 0.6, y, z)),
          new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld));
        expect(ray.intersectObjects(probes, false)[0]?.object.name,
          `visible upholstery skirt at ${side},${y},${z}`).toBe('supermoto-seat');
      }
      for (const side of [-1, 1]) for (const [y, z] of [[0.93966, 0.29239], [0.94374, 0.29346],
        [0.94135, 0.30843], [0.94737, 0.31418]]) {
        const ray = new Raycaster(bike.body.localToWorld(new Vector3(side * 0.6, y, z)),
          new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld));
        expect(['supermoto-seat', 'supermoto-side-cover'], `upper rail concealed at ${side},${y},${z}`)
          .toContain(ray.intersectObjects(probes, false)[0]?.object.name);
      }
      for (const side of [-1, 1]) for (const z of [0.215, 0.225, 0.24]) {
        const ray = new Raycaster(bike.body.localToWorld(new Vector3(side * 0.6, 0.958, z)),
          new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld));
        expect(ray.intersectObjects(probes, false)[0]?.object.name,
          `no upturned pan tab at the front blend ${side},${z}`).toBe('supermoto-seat');
      }
      for (const side of [-1, 1]) for (const z of [0.115, 0.14, 0.16]) {
        const ray = new Raycaster(bike.body.localToWorld(new Vector3(side * 0.6, 0.938, z)),
          new Vector3(-side, 0, 0).transformDirection(bike.body.matrixWorld));
        expect(ray.intersectObjects(probes, false)[0]?.object.name,
          `front seat pan remains below the visible V edge ${side},${z}`).toBe('supermoto-seat');
      }
    } finally { material.dispose(); }
  });
});
