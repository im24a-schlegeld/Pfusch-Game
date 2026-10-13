import * as THREE from 'three';
import type { Player } from '../domain/types';
import { helmetStickerSurfaces, stickerHelmet } from './bikeStickers';
import { finishBaseColor } from '../domain/carbon';
import { applyColorFinish } from './carbonFinish';
import { getPantsColor, getShoesColor } from '../domain/riderColors';

type ColoredMaterial = THREE.MeshStandardMaterial;
type ColorSlot = 'paint' | 'rims' | 'helmetColor' | 'helmetVisor' | 'pantsColor' | 'shoesColor';

/** Geometry changes are separate from material palettes. */
export function previewGeometryKey(player: Player) {
  return JSON.stringify([
    player.bike, player.helmet, player.stickers, player.equipped,
    player.variants, player.customizations,
  ]);
}

/** Capture authored material references once, before different palettes can share a color. */
export function createPreviewColorUpdater(
  body: THREE.Object3D,
  rider: THREE.Object3D,
  player: Player,
) {
  const slots: Record<ColorSlot, Set<ColoredMaterial>> = {
    paint: new Set(), rims: new Set(), helmetColor: new Set(), helmetVisor: new Set(),
    pantsColor: new Set(), shoesColor: new Set(),
  };
  const helmetShade = new Map<ColoredMaterial, number>();
  const initialPaint = new THREE.Color(finishBaseColor(player.paint));
  const initialRim = new THREE.Color(finishBaseColor(player.rims));
  const visitBody = (object: THREE.Object3D) => {
    if (object === rider || object.userData.bikeSticker) return;
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.userData.fixedHardwareFinish) continue;
        const previousSlot = material.userData.appearanceColorSlot as ColorSlot | undefined;
        if (previousSlot === 'paint' || previousSlot === 'rims') { slots[previousSlot].add(material); continue; }
        const importedRim = material.userData.rimPalette ?? /(^|[_\s-])rims?(?=\d|$|[_\s-])/i.test(material.name);
        const authoredRim = !object.userData.importedPart && /rim|wheel-ring|wheel-face/.test(object.name.toLowerCase()) &&
          !/spoke|tyre|tire/.test(object.name.toLowerCase());
        // The Töffli's cast spokes and rim lip intentionally share its rim
        // finish. They are unnamed, unlike imported wheels, and its hub gets
        // a separate finishWheelColors clone during construction.
        const mopedRim = player.bike === '125' && object.parent?.name.endsWith('-wheel') &&
          ((material.metalness === 0.7 && material.roughness === 0.35) ||
            (object.geometry instanceof THREE.CylinderGeometry &&
              object.geometry.parameters.radiusTop >= 0.045 &&
              object.geometry.parameters.radiusTop <= 0.058));
        if ((importedRim || authoredRim || mopedRim) && material.color.equals(initialRim)) {
          slots.rims.add(material);
        } else if (object.userData.bikePaintSurface ||
          (material.color.equals(initialPaint) &&
            ((material.metalness === 0.18 && material.roughness === 0.32) ||
              /^(rear-shock-spring|sport-rear-shock-spring|scooter-rear-spring)$/.test(object.name)))) {
          slots.paint.add(material);
        }
      }
    }
    object.children.forEach(visitBody);
  };
  visitBody(body);
  rider.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const slot: unknown = material.userData.appearanceColorSlot;
      if (slot === 'pantsColor' || slot === 'shoesColor') slots[slot].add(material);
    }
  });
  for (const mesh of helmetStickerSurfaces(rider).values()) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Preserve the authored darker molded panels and painted edge shading.
    for (const [index, material] of materials.entries()) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.userData.appearanceColorSlot === 'helmetColor') {
        slots.helmetColor.add(material); helmetShade.set(material, material.userData.helmetShade ?? 1); continue;
      }
      const shade = material.metalness === 0.12 ? 0.96 : material.roughness === 0.6 ? 0.87 : 1;
      if ((index === 0 || material.metalness === 0.12) &&
        material.color.equals(new THREE.Color(finishBaseColor(player.helmetColor)).multiplyScalar(shade))) {
        slots.helmetColor.add(material);
        helmetShade.set(material, shade);
      }
    }
  }
  const helmet = stickerHelmet(rider);
  if (helmet instanceof THREE.Mesh && player.helmet === 'fullface' && Array.isArray(helmet.material)) {
    const visor = helmet.material[1];
    if (visor instanceof THREE.MeshStandardMaterial) slots.helmetVisor.add(visor);
  }
  helmet?.getObjectByName('motocross-goggle-lens')?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) slots.helmetVisor.add(material);
    }
  });
  const previous: Record<ColorSlot, string> = {
    paint: player.paint, rims: player.rims,
    helmetColor: player.helmetColor, helmetVisor: player.helmetVisor,
    pantsColor: getPantsColor(player), shoesColor: getShoesColor(player),
  };
  const colorSlots = Object.keys(slots) as ColorSlot[];
  for (const slot of colorSlots) for (const material of slots[slot]) {
    material.userData.appearanceColorSlot = slot;
    if (slot === 'helmetColor') material.userData.helmetShade = helmetShade.get(material) ?? 1;
  }
  return (appearance: Pick<Player, ColorSlot>) => {
    let changed = false;
    for (const slot of colorSlots) {
      const value = slot === 'pantsColor' ? getPantsColor(appearance)
        : slot === 'shoesColor' ? getShoesColor(appearance) : appearance[slot];
      if (value === previous[slot]) continue;
      changed = true;
      previous[slot] = value;
      for (const material of slots[slot]) {
        applyColorFinish(material, value, slot === 'helmetColor' ? helmetShade.get(material) ?? 1 : 1);
      }
    }
    return changed;
  };
}
