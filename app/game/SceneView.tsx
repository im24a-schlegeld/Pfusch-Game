import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Player, Product } from '../domain/types';
import { Engine, LANE } from './engine';
import { box, disposeUnique, makeTraffic } from './models';
import { makeBike } from './vehicle';
import { ROAD_EVENT_KINDS } from './roadEvents';
import { makeWorldView } from './worldView';
import { DAY_SKY, makeWorldLighting } from './worldLighting';
import { createBikeHeadlightRig } from './bikeHeadlight';
import { createCrashAnimation } from './crashAnimation';
import { createGarmentGlowUpdater } from './garmentGlow';
import { TRAFFIC_KINDS } from './trafficDomain';
import { animateTraffic } from './trafficModels';
import { createRideParticles, particleAnchors } from './rideParticles';
import { createCrashTravel } from './crashTravel';
import { makeSignCollectibleView } from './signCollectibleView';
import { TAIL_CONTACT } from './tailContact';

// Match makeBike's body selection, including its default Supermoto geometry.
const headlightModel = (id: string) =>
  id === '125' || id === 'scooter' || id === '701' ? id : '450';

interface Props {
  player: Player;
  products: Product[];
  mode: 'menu' | 'garage' | 'ride';
  engine?: Engine;
  onFrame?: (engine: Engine) => void;
  onReady?: () => void;
  onCrashComplete?: () => void;
  inspectionAngle?: number;
  inspectionRevision?: number;
}
export default function SceneView({
  player,
  products,
  mode,
  engine,
  onFrame,
  onReady,
  onCrashComplete,
  inspectionAngle,
  inspectionRevision,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const frameCallback = useRef(onFrame);
  const readyCallback = useRef(onReady);
  const crashCallback = useRef(onCrashComplete);
  const [error, setError] = useState('');
  const appearance = useRef({ player, products, key: '' });
  appearance.current = {
    player,
    products,
    key: JSON.stringify([
      player.bike,
      player.paint,
      player.rims,
      player.helmet,
      player.helmetColor,
      player.equipped,
      player.variants,
      player.customizations,
    ]),
  };
  const inspection = useRef({ inspectionAngle, inspectionRevision });
  inspection.current = { inspectionAngle, inspectionRevision };
  const quality = player.settings.quality;
  frameCallback.current = onFrame;
  readyCallback.current = onReady;
  crashCallback.current = onCrashComplete;
  useEffect(() => {
    const { player, products } = appearance.current;
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: player.settings.quality !== 'low',
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      setError(
        '3D graphics could not start. Enable hardware acceleration or try another browser.',
      );
      return;
    }
    const low = player.settings.quality === 'low';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : 1.6));
    renderer.setClearColor(mode === 'ride' ? DAY_SKY : '#181d1f');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = mode !== 'ride';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const studio = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const environment = environmentGenerator.fromScene(studio, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.7;
    studio.dispose();
    environmentGenerator.dispose();
    scene.fog = new THREE.Fog(
      mode === 'ride' ? DAY_SKY : '#181d1f',
      mode === 'ride' ? 55 : 16,
      mode === 'ride' ? 158 : 65,
    );
    const camera = new THREE.PerspectiveCamera(
      mode === 'ride' ? 61 : 40,
      1,
      0.1,
      190,
    );
    const hemisphere = new THREE.HemisphereLight('#e3f0f2', '#343a2f', 1.4);
    scene.add(hemisphere);
    const sunlight = new THREE.DirectionalLight('#fff5e6', 3.4);
    sunlight.position.set(-3, 7, 4);
    sunlight.castShadow = mode !== 'ride';
    sunlight.shadow.mapSize.set(low ? 512 : 1024, low ? 512 : 1024);
    Object.assign(sunlight.shadow.camera, {
      left: -4,
      right: 4,
      top: 4,
      bottom: -4,
      near: 0.1,
      far: 20,
    });
    sunlight.shadow.normalBias = 0.015;
    sunlight.shadow.bias = -0.00015;
    scene.add(sunlight);
    const fill = new THREE.DirectionalLight('#a4bcd1', 0.9);
    fill.position.set(12, 8, -10);
    scene.add(fill);
    let bike = makeBike(player, products);
    bike.root.name = 'player-bike';
    let vehicleKey = appearance.current.key,
      vehicleProducts = products;
    scene.add(bike.root);
    let updateGlow = createGarmentGlowUpdater(bike.root);
    let headlightRig = createBikeHeadlightRig(headlightModel(player.bike));
    const lighting =
      mode === 'ride'
        ? makeWorldLighting(scene, renderer, hemisphere, sunlight, fill)
        : null;
    let worldView: ReturnType<typeof makeWorldView> | undefined;
    const traffic: THREE.Group[] = [];
    const templates = new Map<string, THREE.Group>();
    let appliedAngle = inspection.current.inspectionAngle,
      appliedRevision = inspection.current.inspectionRevision;
    let rotation = appliedAngle ?? 2.35;
    let dragging = false;
    let previousX = 0;
    let tilt = 0;
    let landingSerial = 0,
      landing = 0;
    let suspension = 0,
      previousSpeed = engine?.speed ?? 22;
    let previousXPosition = engine?.x ?? 0,
      previousLateralSpeed = 0;
    let crash: ReturnType<typeof createCrashAnimation> | undefined;
    let crashTravel: ReturnType<typeof createCrashTravel> | undefined;
    let launchSerial = 0,
      launchPulse = 0;
    let anchors = particleAnchors(bike.body, player.bike);
    const exhaustPosition = new THREE.Vector3(),
      tailPosition = new THREE.Vector3();
    const particles = mode === 'ride' ? createRideParticles(scene, low) : null;
    const signs =
      mode === 'ride' ? makeSignCollectibleView(8, LANE, low) : null;
    if (signs) scene.add(signs.root);
    let crashNotified = false;
    let crashReported = false;
    if (mode === 'ride') {
      worldView = makeWorldView(scene, low);
      for (let i = 0; i < 32; i++) {
        const group = new THREE.Group();
        group.visible = false;
        scene.add(group);
        traffic.push(group);
      }
      for (const kind of [...TRAFFIC_KINDS, ...ROAD_EVENT_KINDS])
        for (let color = 0; color < 4; color++)
          templates.set(`${kind}:${color}`, makeTraffic(kind, color));
    } else {
      box(scene, 100, 0.2, 100, 0, -0.12, 0, '#262d2f');
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4, 2.48, 0.12, 64),
        new THREE.MeshStandardMaterial({
          color: '#343c3e',
          metalness: 0.4,
          roughness: 0.6,
        }),
      );
      platform.position.y = -0.06;
      platform.receiveShadow = true;
      scene.add(platform);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.38, 0.012, 4, 80),
        new THREE.MeshBasicMaterial({ color: '#9ca582' }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.002;
      scene.add(ring);
      for (let i = -4; i <= 4; i++) {
        box(scene, 0.015, 0.004, 60, i * 3, 0.002, 0, '#475052');
        box(scene, 60, 0.004, 0.015, 0, 0.002, i * 3, '#475052');
      }
      box(scene, 35, 14, 0.3, 0, 6, -10, '#222a2d');
      for (let i = -4; i <= 4; i++)
        box(scene, 0.1, 12, 0.22, i * 4, 6, -9.8, '#394548');
      for (const x of [-7, 7]) {
        box(scene, 0.15, 12, 0.2, x, 6, -9.5, '#b9c6b6');
        box(scene, 1.5, 0.05, 5, x, 7, -6, '#b9c6b6');
      }
      for (const x of [-6, 6]) {
        box(scene, 2.3, 1.2, 1.6, x, 0.6, -5, '#333d3e');
        for (let j = 0; j < 3; j++)
          box(scene, 2.1, 0.035, 0.04, x, 0.4 + j * 0.3, -4.17, '#627173');
      }
    }
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const down = (e: PointerEvent) => {
      if (mode === 'ride') return;
      dragging = true;
      previousX = e.clientX;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging) {
        rotation += (e.clientX - previousX) * 0.009;
        previousX = e.clientX;
      }
    };
    const up = () => {
      dragging = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    const contextLost = (e: Event) => {
      e.preventDefault();
      engine?.pause();
      setError(
        'Graphics paused. Reload the page to restore the 3D view. Your completed rides are saved.',
      );
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    let raf = 0,
      last = performance.now(),
      hud = 0,
      clock = 0;
    let ready = false;
    let focused = document.hasFocus(),
      visible = !document.hidden;
    const visualBlur = () => {
      focused = false;
    };
    const visualFocus = () => {
      focused = true;
      last = performance.now();
    };
    const visualVisibility = () => {
      visible = !document.hidden;
      last = performance.now();
    };
    window.addEventListener('blur', visualBlur);
    window.addEventListener('focus', visualFocus);
    document.addEventListener('visibilitychange', visualVisibility);
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      clock += dt;
      let crashComplete = false;
      const nextAppearance = appearance.current;
      if (
        nextAppearance.key !== vehicleKey ||
        nextAppearance.products !== vehicleProducts
      ) {
        scene.remove(bike.root);
        disposeVehicle(bike.root);
        bike = makeBike(nextAppearance.player, nextAppearance.products);
        bike.root.name = 'player-bike';
        crash = undefined;
        crashTravel = undefined;
        anchors = particleAnchors(bike.body, nextAppearance.player.bike);
        scene.add(bike.root);
        updateGlow = createGarmentGlowUpdater(bike.root);
        headlightRig = createBikeHeadlightRig(
          headlightModel(nextAppearance.player.bike),
        );
        vehicleKey = nextAppearance.key;
        vehicleProducts = nextAppearance.products;
      }
      const command = inspection.current;
      if (
        command.inspectionAngle !== appliedAngle ||
        command.inspectionRevision !== appliedRevision
      ) {
        appliedAngle = command.inspectionAngle;
        appliedRevision = command.inspectionRevision;
        if (appliedAngle !== undefined) rotation = appliedAngle;
      }
      if (engine && mode === 'ride') {
        engine.advance(dt);
        const moving = engine.phase === 'playing';
        const crashed =
          engine.phase === 'crashed' && engine.event.text !== 'Ride ended';
        const crashActive = focused && visible;
        let longitudinalAcceleration = 0,
          lateralAcceleration = 0;
        if (crashed && !crashTravel)
          crashTravel = createCrashTravel(
            engine.speed,
            /collision/i.test(engine.event.text),
            appearance.current.player.settings.reducedMotion,
          );
        crashTravel?.advance(dt, crashed && crashActive);
        const distance = engine.distance + (crashTravel?.distance ?? 0);
        worldView!.update(engine.world, distance);
        updateGlow(
          lighting!.update(
            engine.world,
            distance,
            engine.x,
            headlightRig.count,
          ),
        );
        bike.root.position.set(engine.x, engine.height, 0);
        if (moving) {
          if (engine.landingSerial !== landingSerial) {
            landingSerial = engine.landingSerial;
            landing = Math.min(1, engine.landingSpeed / 6.5);
          } else landing *= Math.exp(-dt * 9);
          const frontLift = Math.min(
            1,
            engine.wheelieAngle / engine.balanceProfile.balancePoint,
          );
          tilt = Math.min(
            engine.wheelieAngle,
            TAIL_CONTACT[appearance.current.player.bike].angle,
          );
          if (launchSerial !== engine.wheelieLaunchSerial) {
            launchSerial = engine.wheelieLaunchSerial;
            launchPulse = 1;
          } else launchPulse *= Math.exp(-dt * 10);
          const launch = appearance.current.player.settings.reducedMotion
            ? 0
            : launchPulse;
          const acceleration = dt > 0 ? (engine.speed - previousSpeed) / dt : 0;
          longitudinalAcceleration = Number.isFinite(acceleration)
            ? acceleration
            : 0;
          const lateralSpeed = dt > 0 ? (engine.x - previousXPosition) / dt : 0;
          const lateralChange =
            dt > 0 ? (lateralSpeed - previousLateralSpeed) / dt : 0;
          lateralAcceleration = Number.isFinite(lateralChange)
            ? lateralChange
            : 0;
          previousLateralSpeed = lateralSpeed;
          previousSpeed = engine.speed;
          const road = appearance.current.player.settings.reducedMotion
            ? 0
            : Math.sin(distance * 1.7) * 0.45 +
              Math.sin(distance * 0.57) * 0.25 +
              Math.sin(distance * 8) * engine.roadRoughness * 0.3;
          const load = THREE.MathUtils.clamp(
            acceleration * 0.35 +
              engine.throttleLoad * 0.3 -
              engine.forwardLoad * 0.6,
            -1,
            1,
          );
          const balance = THREE.MathUtils.clamp(
            (engine.forwardLoad - engine.throttleLoad * 0.4) * frontLift +
              engine.wheelieAngularVelocity * 0.2,
            -1,
            1,
          );
          const steering = (engine.lane * LANE - engine.x) / LANE;
          const balancing = engine.wheelie
            ? Math.sin(engine.elapsed * 3.5) * 0.045 * frontLift +
              steering * 0.28
            : steering;
          const drift =
            !engine.wheelie && engine.height === 0
              ? engine.laneChangeDirection *
                Math.sin(Math.min(1, engine.laneChangeAge / 0.32) * Math.PI)
              : 0;
          bike.animateRider(
            {
              wheelie: frontLift,
              forward: engine.forwardLoad,
              steer: balancing,
              landing,
              launch,
              balance,
              load,
              road,
            },
            dt,
          );
          const compression =
            landing * 0.022 +
            engine.forwardLoad * 0.003 -
            launch * 0.006 +
            road * 0.002 +
            engine.roadRoughness * 0.014;
          suspension += (compression - suspension) * (1 - Math.exp(-dt * 18));
          bike.root.rotation.z = THREE.MathUtils.lerp(
            bike.root.rotation.z,
            appearance.current.player.settings.reducedMotion
              ? 0
              : -balancing * 0.16 - drift * 0.026,
            1 - Math.exp(-dt * 12),
          );
          bike.root.rotation.y = appearance.current.player.settings
            .reducedMotion
            ? 0
            : drift * 0.105;
        }
        if (!moving) previousLateralSpeed = 0;
        previousXPosition = engine.x;
        if (crashed) {
          if (!crash) {
            tilt = Math.min(
              engine.wheelieAngle,
              TAIL_CONTACT[appearance.current.player.bike].angle,
            );
            bike.animateSuspension(tilt, suspension);
            crash = createCrashAnimation(bike, {
              cause: engine.event.text,
              pitch: tilt,
              travel: suspension,
              reducedMotion: appearance.current.player.settings.reducedMotion,
            });
          }
          crashComplete = crash.advance(dt, crashActive);
        } else bike.animateSuspension(tilt, suspension);
        // Final ordinary/crash pose: accessory gravity and both light endpoints
        // consume these same transforms before the scene is rendered.
        bike.animateAccessories(
          {
            longitudinalAcceleration,
            lateralAcceleration,
            landing,
            paused:
              engine.phase === 'paused' ||
              engine.phase === 'ready' ||
              (crashed && !crashActive),
            reducedMotion: appearance.current.player.settings.reducedMotion,
          },
          crashed && !crashActive ? 0 : dt,
        );
        headlightRig.copyPose(bike.body, lighting!.headlights);
        anchors.copy(exhaustPosition, tailPosition);
        particles?.update(
          dt,
          crashActive && (moving || crashed),
          moving,
          crashTravel?.speed ?? engine.speed,
          appearance.current.player.bike,
          exhaustPosition,
          tailPosition,
          engine.scrapeIntensity,
          engine.scrapeMaterial,
          appearance.current.player.paint,
          appearance.current.player.settings.reducedMotion,
        );
        signs?.update(engine.signs, engine.elapsed);
        if (signs) signs.root.position.z = crashTravel?.distance ?? 0;
        if (moving || (crashed && crashActive))
          for (const wheel of bike.wheels)
            wheel.rotation.x -=
              ((crashTravel?.speed ?? engine.speed) * dt) / 0.47;
        engine.obstacles.forEach((o, i) => {
          const group = traffic[i];
          group.visible = o.active;
          if (!o.active) return;
          group.position.set(
            o.lane * LANE + o.offsetX,
            0,
            -o.z +
              (crashTravel?.distance ?? 0) -
              o.velocity * (crashTravel?.elapsed ?? 0),
          );
          const key = `${o.kind}:${o.color}`;
          if (group.userData.key !== key) {
            group.clear();
            group.add(templates.get(key)!.clone(true));
            group.userData.key = key;
          }
          animateTraffic(
            group,
            o.velocity,
            moving || (crashed && crashActive) ? dt : 0,
          );
        });
        const shake =
          appearance.current.player.settings.reducedMotion || !moving
            ? 0
            : Math.sin(clock * 23) * 0.016;
        const portraitRide = camera.aspect < 0.8;
        const chaseZ = portraitRide ? 10.4 : 8.4;
        camera.position.set(
          engine.x * 0.27 + shake,
          4.4 + engine.height * 0.13,
          chaseZ,
        );
        camera.lookAt(engine.x * 0.38, 1.4, -12);
        if (crash) {
          const blend = crash.cameraBlend;
          camera.position.set(
            THREE.MathUtils.lerp(engine.x * 0.27, crash.focus.x, blend),
            THREE.MathUtils.lerp(4.4 + engine.height * 0.13, 3.5, blend),
            THREE.MathUtils.lerp(chaseZ, 7.2, blend),
          );
          camera.lookAt(
            THREE.MathUtils.lerp(engine.x * 0.38, crash.focus.x, blend),
            THREE.MathUtils.lerp(1.4, crash.focus.y, blend),
            THREE.MathUtils.lerp(-12, crash.focus.z, blend),
          );
        }
        const speedFov = 61 + (engine.speed - 22) * 0.22;
        // Keep the rider visible on either outer lane without a distant phone camera.
        const fov = portraitRide
          ? Math.max(
              speedFov,
              THREE.MathUtils.radToDeg(
                2 *
                  Math.atan(
                    Math.tan(THREE.MathUtils.degToRad(25)) / camera.aspect,
                  ),
              ),
            )
          : speedFov;
        if (Math.abs(camera.fov - fov) > 0.05) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        hud += dt;
        if (hud > 0.075 || (engine.phase === 'crashed' && !crashReported)) {
          frameCallback.current?.(engine);
          if (engine.phase === 'crashed') crashReported = true;
          hud = 0;
        }
      } else {
        if (
          !dragging &&
          !appearance.current.player.settings.reducedMotion &&
          appliedAngle === undefined &&
          mode === 'menu'
        )
          rotation += dt * 0.04;
        bike.root.rotation.y = rotation;
        const portrait = camera.aspect < 0.8;
        camera.position.set(
          0,
          mode === 'garage' ? 2.7 : 2.9,
          mode === 'garage' ? (portrait ? 7.2 : 5.5) : portrait ? 8.8 : 7.4,
        );
        camera.lookAt(0, 1.3, 0);
        bike.animateAccessories({ reducedMotion: true }, dt);
      }
      renderer.render(scene, camera);
      if (crashComplete && !crashNotified) {
        crashNotified = true;
        crashCallback.current?.();
      }
      if (!ready) {
        ready = true;
        readyCallback.current?.();
      }
    };
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('blur', visualBlur);
      window.removeEventListener('focus', visualFocus);
      document.removeEventListener('visibilitychange', visualVisibility);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      disposeUnique(scene);
      disposeSkeletons(scene);
      particles?.dispose();
      signs?.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geometries.add(o.geometry);
          if (Array.isArray(o.material)) o.material.forEach((m) => mats.add(m));
          else mats.add(o.material);
        }
      });
      templates.forEach((t) =>
        t.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            geometries.add(o.geometry);
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(
              (m) => mats.add(m),
            );
          }
        }),
      );
      geometries.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      renderer.dispose();
      environment.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [mode, engine, quality]);
  return (
    <div
      className={`scene scene-${mode}`}
      ref={host}
      aria-label={
        mode === 'ride'
          ? 'Three lane motorcycle road'
          : 'Interactive rider and motorcycle preview'
      }
    >
      {error && (
        <div className="graphics-error" role="alert">
          {error}
          <button className="button" onClick={() => window.location.reload()}>
            RELOAD
          </button>
        </div>
      )}
    </div>
  );
}
function disposeVehicle(root: THREE.Object3D) {
  disposeSkeletons(root);
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        materials.add(m),
      );
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
function disposeSkeletons(root: THREE.Object3D) {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
  });
  skeletons.forEach((s) => s.dispose());
}
