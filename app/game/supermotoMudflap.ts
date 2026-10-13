import * as THREE from 'three';

/** The original exported trim includes the guard between the rear wheel and
 * muffler. Admit that authored surface; never add a hanging plate to the tail
 * or rename its mesh, which existing saved sticker placements reference.
 */
export function tagImportedSupermotoMudflap(body: THREE.Group) {
  const guard = body.getObjectByName('fs450_inner_trim:body');
  if (!(guard instanceof THREE.Mesh)) throw new Error('Der originale Supermoto-Heckschutz fehlt.');
  guard.userData.bikeStickerSurface = true;
}
