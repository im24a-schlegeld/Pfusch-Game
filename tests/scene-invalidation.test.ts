import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneInvalidation } from '../app/game/sceneInvalidation';

describe('stationary scene rendering', () => {
  it('renders one frame across 600 unchanged animation ticks, then responds immediately to controls', () => {
    const invalidation = createSceneInvalidation();
    const decisions = Array.from({ length: 600 }, () => invalidation.consume());
    expect(decisions.filter(Boolean)).toHaveLength(1);
    invalidation.invalidate();
    expect(invalidation.consume()).toBe(true);
    expect(invalidation.consume()).toBe(false);
  });

  it('redraws a settled preview when late garment or sticker artwork loads', () => {
    const artwork = new THREE.Texture();
    const sticker = new THREE.Texture();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), [
      new THREE.MeshStandardMaterial({ map: artwork }),
      new THREE.MeshStandardMaterial({ map: artwork, alphaMap: sticker }),
    ]));
    const invalidation = createSceneInvalidation();
    invalidation.track(root);
    expect(invalidation.consume()).toBe(true);
    expect(invalidation.consume()).toBe(false);
    artwork.needsUpdate = true;
    expect(invalidation.consume()).toBe(true);
    expect(invalidation.consume()).toBe(false);
    sticker.needsUpdate = true;
    expect(invalidation.consume()).toBe(true);
    // Cloned textures share their decoded image source. Loading the original
    // can update the source without changing the displayed clone's version.
    const clone = artwork.clone();
    invalidation.track(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: clone })));
    invalidation.consume();
    artwork.needsUpdate = true;
    expect(invalidation.consume()).toBe(true);
  });

  it('replaces old artwork subscriptions when another bike is previewed', () => {
    const oldMap = new THREE.Texture();
    const nextMap = new THREE.Texture();
    const invalidation = createSceneInvalidation();
    invalidation.track(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: oldMap })));
    invalidation.consume();
    invalidation.track(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: nextMap })));
    expect(invalidation.consume()).toBe(true);
    oldMap.needsUpdate = true;
    expect(invalidation.consume()).toBe(false);
    nextMap.needsUpdate = true;
    expect(invalidation.consume()).toBe(true);
  });
});
