import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BIKES, MAX_RIDE_SPEED } from '../app/domain/config';
import { Engine } from '../app/game/engine';
import { selectTutorialCue, safeTutorialWindow, visibleTutorialProjection, type TutorialTarget } from '../app/game/tutorialCues';

function ride() { const engine = new Engine(BIKES[2], 42); engine.start(); return engine; }
function projection(aspect = 390 / 844) {
  const fov = Math.max(61, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / aspect)));
  const camera = new THREE.PerspectiveCamera(fov, aspect, .1, 190);
  camera.position.set(0, 4.4, aspect < .8 ? 10.4 : 8.4);
  camera.lookAt(0, 1.4, -12); camera.updateMatrixWorld(true);
  return (target: TutorialTarget) => {
    const world = new THREE.Vector3(target.x, target.y, target.z);
    const depth = -world.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const point = world.project(camera);
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2, depth, clipZ: point.z };
  };
}

describe('contextual tutorial observations', () => {
  it('selects the closest unseen real encounter without mutating the engine', () => {
    const engine = ride();
    engine.spawn('towtruck', 1, 65);
    engine.spawn('car', -1, 57, 0, 0, true);
    Object.assign(engine.signs[0], { active: true, lane: 0, z: 42 });
    const before = JSON.stringify(engine);
    expect(selectTutorialCue(engine, [], projection())?.id).toBe('signs');
    expect(selectTutorialCue(engine, ['signs'], projection())?.id).toBe('police');
    expect(selectTutorialCue(engine, ['signs', 'police'], projection())?.id).toBe('ramp');
    expect(selectTutorialCue(engine, ['signs', 'police', 'ramp'], projection())).toBeNull();
    expect(JSON.stringify(engine)).toBe(before);
  });
  it.each([390 / 844, 844 / 390])('projects actual ramp, roadside radar and traffic into viewport aspect %s', (aspect) => {
    const engine = ride();
    engine.spawn('towtruck', 1, 58);
    const ramp = selectTutorialCue(engine, [], projection(aspect));
    expect(ramp?.id).toBe('ramp');
    expect(ramp!.x).toBeGreaterThan(.5);
    engine.obstacles.forEach(o => { o.active = false; });
    Object.assign(engine.speedCamera, { active: true, distance: 58, side: -1, triggered: false });
    const radar = selectTutorialCue(engine, [], projection(aspect));
    expect(radar?.id).toBe('radar');
    expect(radar!.x).toBeLessThan(.5);
    engine.speedCamera.active = false;
    engine.spawn('van', 1, 55);
    expect(selectTutorialCue(engine, [], projection(aspect))?.id).toBe('traffic');
  });
  it('keeps a multi-sample radar window at the real 140 km/h speed cap', () => {
    const engine = ride(); engine.speed = MAX_RIDE_SPEED;
    Object.assign(engine.speedCamera, { active: true, distance: 90, side: -1, triggered: false });
    let visibleSamples = 0;
    // Check actual 150 ms observation intervals, without advancing any physics.
    for (let elapsed = 0; elapsed < .6; elapsed += .15) {
      engine.distance = MAX_RIDE_SPEED * elapsed;
      if (selectTutorialCue(engine, [], projection())?.id === 'radar') visibleSamples++;
    }
    expect(visibleSamples).toBeGreaterThanOrEqual(3);
  });
  it.each([
    { x: -.01, y: .5, depth: 40, clipZ: .5 },
    { x: 1.01, y: .5, depth: 40, clipZ: .5 },
    { x: .5, y: 1.1, depth: 40, clipZ: .5 },
    { x: .5, y: .5, depth: -40, clipZ: .5 },
    { x: .5, y: .5, depth: 40, clipZ: 1.1 },
    { x: Number.NaN, y: .5, depth: 40, clipZ: .5 },
  ])('never clamps an invisible target onto the screen: %j', (point) => {
    const engine = ride(); engine.spawn('towtruck', 1, 55);
    expect(visibleTutorialProjection(point)).toBe(false);
    expect(selectTutorialCue(engine, [], () => point)).toBeNull();
  });
  it('ignores passed/used targets, unready models and a pursuing car behind the camera', () => {
    const engine = ride();
    const ramp = engine.spawn('towtruck', 1, 55)!;
    ramp.rampUsed = true;
    Object.assign(engine.policeVehicle, { visible: true, phase: 'chasing', z: -12 });
    expect(selectTutorialCue(engine, [], projection())).toBeNull();
    ramp.rampUsed = false;
    expect(selectTutorialCue(engine, [], () => null)).toBeNull();
    ramp.passed = true;
    expect(selectTutorialCue(engine, [], projection())).toBeNull();
  });
  it('postpones hints during air travel, pauses, imminent lane collisions and late pursuits', () => {
    const engine = ride(); engine.spawn('towtruck', 1, 60);
    expect(safeTutorialWindow(engine)).toBe(true);
    engine.height = .2; expect(safeTutorialWindow(engine)).toBe(false);
    engine.height = 0;
    engine.pause(); expect(selectTutorialCue(engine, [], projection())).toBeNull();
    engine.resumeTutorial();
    const obstacle = engine.spawn('car', 0, 20)!;
    expect(safeTutorialWindow(engine)).toBe(false);
    obstacle.lane = -1;
    expect(safeTutorialWindow(engine)).toBe(true);
    const plate = engine.spawn('barrier', 0, 20)!;
    expect(safeTutorialWindow(engine)).toBe(false);
    plate.active = false;
    const constructionRamp = engine.spawn('ramp', 0, 20)!;
    expect(safeTutorialWindow(engine)).toBe(false);
    expect(selectTutorialCue(engine, [], projection())).toBeNull();
    constructionRamp.lane = -1;
    expect(safeTutorialWindow(engine)).toBe(true);
    constructionRamp.active = false;
    engine.policeChase = true; engine.policeRamRemaining = 5;
    expect(safeTutorialWindow(engine)).toBe(false);
  });
});
