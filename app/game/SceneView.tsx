import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import * as THREE from 'three';
import { suspensionTarget } from './activeSuspension';
import { wheelieLanePose } from './riderMotion';
import { handlebarSteeringInput } from './bikeMotion';
import { rendererSessions } from './rendererSession';
import type { Player, Product, TutorialHint } from '../domain/types';
import { Engine, LANE } from './engine';
import { disposeUnique, makeTrafficVariants } from './models';
import { makeBike } from './vehicle';
import { makeWorldView } from './worldView';
import { DAY_SKY, makeWorldLighting } from './worldLighting';
import { applyCartoonHeroStyle, applyCartoonStyle } from './cartoonStyle';
import { createCartoonOutline } from './cartoonOutline';
import { makeCartoonSky } from './cartoonSky';
import { createBikeHeadlightGlowUpdater, createBikeHeadlightRig } from './bikeHeadlight';
import { createCrashAnimation } from './crashAnimation';
import { createGarmentGlowUpdater } from './garmentGlow';
import {
  TRAFFIC_KINDS,
  TRAFFIC_SHAPES,
  trafficFrontReach,
} from './trafficDomain';
import { animateTraffic } from './trafficModels';
import { trafficYaw } from './trafficProgression';
import { captureRidePose } from './revivePresentation';
import { createRideParticles, particleAnchors } from './rideParticles';
import { createCrashTravel, type CrashDirection } from './crashTravel';
import { makeSignCollectibleView } from './signCollectibleView';
import { TAIL_CONTACT } from './tailContact';
import { applyBikeStickers, applyHelmetStickers, clearBikeStickers } from './bikeStickers';
import { helmetStickerTarget } from '../domain/stickers';
import { createPoliceCrashEffect } from './policeCrashEffect';
import { importedBikeReady, preloadImportedBike } from './importedBikeAsset';
import LoadingScreen, { PreviewLoading } from '../ui/LoadingScreen';
import SceneFallback from '../ui/SceneFallback';
import { createPreviewColorUpdater, previewGeometryKey } from './previewAppearance';
import { createSceneInvalidation } from './sceneInvalidation';
import { createRenderCadence } from './renderCadence';
import { selectTutorialCue, visibleTutorialProjection, type TutorialCue, type TutorialTarget } from './tutorialCues';

export type InspectionFocus = 'model' | 'paint' | 'rims' | 'upper' | 'head' | 'cap' | 'accessory' | 'cape' | 'keychain' | 'lower' | 'feet';

export const preloadBikeAsset = preloadImportedBike;

// Match makeBike's body selection, including its default Supermoto geometry.
const headlightModel = (id: string) =>
  id === '125' || id === 'scooter' || id === 'moped' || id === '701' ? id : '450';

/** A stale sticker placement must never prevent the motorcycle from rendering. */
function applyStickersSafely(
  bike: ReturnType<typeof makeBike>,
  player: Player,
) {
  try {
    applyBikeStickers(
      bike.body,
      bike.rider,
      player.paint,
      player.stickers[player.bike] ?? [],
    );
    applyHelmetStickers(bike.rider, player.stickers[helmetStickerTarget(player.helmet)] ?? []);
  } catch (error) {
    console.error(
      'Gespeicherte Sticker konnten nicht angewendet werden.',
      error,
    );
    clearBikeStickers(bike.body);
  }
}

interface Props {
  player: Player;
  products: Product[];
  mode: 'menu' | 'garage' | 'ride';
  engine?: Engine;
  onFrame?: (engine: Engine) => void;
  onReady?: () => void;
  onLoadError?: (message: string) => void;
  onCrashComplete?: () => void;
  onTutorialCue?: (cue: TutorialCue | null) => void;
  tutorialHintsSeen?: readonly TutorialHint[];
  inspectionAngle?: number;
  inspectionRevision?: number;
  inspectionFocus?: InspectionFocus;
}
export default function SceneView({
  player,
  products,
  mode,
  engine,
  onFrame,
  onReady,
  onLoadError,
  onCrashComplete,
  onTutorialCue,
  tutorialHintsSeen = player.settings.tutorialHintsSeen,
  inspectionAngle,
  inspectionRevision,
  inspectionFocus = 'model',
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const frameCallback = useRef(onFrame);
  const readyCallback = useRef(onReady);
  const errorCallback = useRef(onLoadError);
  const crashCallback = useRef(onCrashComplete);
  const tutorial = useRef({ callback: onTutorialCue, seen: tutorialHintsSeen ?? [] });
  tutorial.current = { callback: onTutorialCue, seen: tutorialHintsSeen ?? [] };
  const [error, setError] = useState('');
  const [renderReady, setRenderReady] = useState(false);
  const [hasUsableAsset, setHasUsableAsset] = useState(() => importedBikeReady(player.bike));
  const [assetLoading, setAssetLoading] = useState(false);
  const zoomPreview = useRef<(factor: number) => void>(() => {});
  const appearance = useRef({ player, products, key: '' });
  appearance.current = {
    player,
    products,
    key: previewGeometryKey(player),
  };
  const inspection = useRef({ inspectionAngle, inspectionRevision, inspectionFocus });
  inspection.current = { inspectionAngle, inspectionRevision, inspectionFocus };
  const quality = player.settings.quality;
  frameCallback.current = onFrame;
  readyCallback.current = onReady;
  errorCallback.current = onLoadError;
  crashCallback.current = onCrashComplete;
  useEffect(() => {
    if (error) errorCallback.current?.(error);
  }, [error]);
  useEffect(() => {
    let cancelled = false;
    if (importedBikeReady(player.bike)) {
      setAssetLoading(false);
      setHasUsableAsset(true);
      return;
    }
    setAssetLoading(true);
    preloadImportedBike(player.bike).then(() => {
      if (!cancelled) {
        setHasUsableAsset(true);
        setAssetLoading(false);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setAssetLoading(false);
        setError(reason instanceof Error ? reason.message : 'Motorradmodell konnte nicht geladen werden.');
      }
    });
    return () => { cancelled = true; };
  }, [player.bike]);
  useEffect(() => {
    setRenderReady(false);
    setError('');
    const { player, products } = appearance.current;
    if (!hasUsableAsset || !importedBikeReady(player.bike)) return;
    const el = host.current;
    if (!el) return;
    let session: ReturnType<typeof rendererSessions.acquire>;
    try {
      session = rendererSessions.acquire(player.settings.quality !== 'low');
    } catch {
      setError(
        '3D-Grafik konnte nicht gestartet werden. Aktiviere Hardwarebeschleunigung oder nutze einen anderen Browser.',
      );
      return;
    }
    const { renderer, environment } = session;
    const low = player.settings.quality === 'low';
    // Cap render resolution before it can multiply the Three.js workload on
    // high-DPI desktop displays. Gameplay uses the same fixed-step engine.
    const mobileViewport = window.matchMedia('(pointer: coarse)').matches;
    const pixelCap = low ? 1 : mobileViewport ? 2 : mode === 'ride' ? 1.35 : 1.2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap));
    renderer.setClearColor(mode === 'ride' ? DAY_SKY : '#323232');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = mode !== 'ride' && !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.userData.visualStyle = 'cartoon';
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.7;
    scene.fog = new THREE.Fog(
      mode === 'ride' ? DAY_SKY : '#323232',
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
    sunlight.shadow.mapSize.set(low ? 256 : 512, low ? 256 : 512);
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
    let bike: ReturnType<typeof makeBike>;
    try {
      bike = makeBike(player, products);
    } catch (error) {
      console.error('Motorrad-Vorschau konnte nicht erstellt werden.', error);
      session.release();
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setError(`Motorrad-Vorschau konnte nicht erstellt werden.${detail}`);
      return;
    }
    applyStickersSafely(bike, player);
    applyCartoonHeroStyle(bike.root);
    let heroOutline = createCartoonOutline(bike.root);
    heroOutline.update(el.clientWidth, el.clientHeight);
    const invalidation = createSceneInvalidation();
    invalidation.track(bike.root);
    bike.root.name = 'player-bike';
    let vehicleKey = appearance.current.key,
      vehicleProducts = products;
    scene.add(bike.root);
    let updateGlow = createGarmentGlowUpdater(bike.root);
    let updateHeadlightGlow = createBikeHeadlightGlowUpdater(bike.body);
    let updateColors = createPreviewColorUpdater(bike.body, bike.rider, player);
    let headlightRig = createBikeHeadlightRig(headlightModel(player.bike));
    const lighting =
      mode === 'ride'
        ? makeWorldLighting(scene, renderer, hemisphere, sunlight, fill)
        : null;
    const sky = mode === 'ride' ? makeCartoonSky(scene, camera) : null;
    let worldView: ReturnType<typeof makeWorldView> | undefined;
    const traffic: THREE.Group[] = [];
    const templates = new Map<string, THREE.Group>();
    const variantSets = new Map<string, readonly THREE.Group[]>();
    let appliedAngle = inspection.current.inspectionAngle,
      appliedRevision = inspection.current.inspectionRevision;
    let rotation = appliedAngle ?? 2.35;
    let appliedFocus = inspection.current.inspectionFocus;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reducedMotion = () => appearance.current.player.settings.reducedMotion || motionPreference.matches;
    let zoom = 1;
    const previewLook = new THREE.Vector3(0, 1.3, 0);
    let cameraTransition: {
      start: number; from: THREE.Vector3; to: THREE.Vector3;
      lookFrom: THREE.Vector3; lookTo: THREE.Vector3; rotationFrom: number; rotationTo: number;
    } | undefined;
    const previewTargets = (focus: InspectionFocus, angle: number) => {
      const portrait = camera.aspect < 0.8;
      const defaults = {
        model: [1.3, portrait ? 7.2 : 5.5, 1.4],
        paint: [0.9, portrait ? 5.9 : 4.5, 1.15],
        rims: [0.48, portrait ? 5.2 : 4.25, 0.4],
        upper: [2, portrait ? 3.2 : 2.7, 0.28],
        head: [2.65, portrait ? 2.1 : 1.7, 0.12],
        cap: [1.4, portrait ? 1.8 : 1.5, 0.08],
        accessory: [1.65, portrait ? 3.7 : 3, 0.28],
        cape: [2, portrait ? 4.2 : 3.5, 0.18],
        keychain: [1.1, portrait ? 2.7 : 2.3, 0.45],
        lower: [1.15, portrait ? 3.6 : 3.0, 0.2],
        feet: [0.65, portrait ? 2.4 : 1.9, 0.12],
      } satisfies Record<InspectionFocus, number[]>;
      const [y, distance, elevation] = defaults[focus];
      const look = new THREE.Vector3(0, y, 0);
      const name = focus === 'upper' ? 'tailored-garment'
        : focus === 'head' ? (appearance.current.player.helmet === 'fullface' ? 'full-face-helmet' : 'motocross-helmet')
          : focus === 'cap' ? 'carried-cap' : focus === 'cape' ? 'pfusch-flag-cape' : focus === 'accessory' ? 'carried-crossbody-bag' : focus === 'keychain' ? 'keychain-fabric-tag' : '';
      const target = focus === 'model' ? bike.root : name ? bike.root.getObjectByName(name) : undefined;
      if (target) {
        const priorRotation = bike.root.rotation.y;
        bike.root.rotation.y = angle;
        bike.root.updateMatrixWorld(true);
        // Whole-model framing follows the actual adult rider and motorcycle,
        // so shorter Ciao and taller Supermoto share a vertically centred view.
        new THREE.Box3().setFromObject(target, focus === 'cape' || focus === 'model').getCenter(look);
        bike.root.rotation.y = priorRotation;
        bike.root.updateMatrixWorld(true);
      }
      return { look, position: look.clone().add(new THREE.Vector3(0, elevation, distance * zoom)) };
    };
    const focusAngles: Record<InspectionFocus, number> = { model: 2.35, paint: 1.65, rims: 1.55, upper: 2.45, head: 2.6, cap: 1.65, accessory: 3.75, cape: 0.3, keychain: 1.65, lower: 1.65, feet: 1.65 };
    const transitionPreview = (now: number, focus: InspectionFocus, angle = rotation) => {
      invalidation.invalidate();
      const target = previewTargets(focus, angle);
      const delta = Math.atan2(Math.sin(angle - rotation), Math.cos(angle - rotation));
      cameraTransition = {
        start: now, from: camera.position.clone(), to: target.position,
        lookFrom: previewLook.clone(), lookTo: target.look,
        rotationFrom: rotation, rotationTo: rotation + delta,
      };
    };
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
    let impactTraffic: THREE.Group | undefined;
    let restoreRidePose: (() => void) | undefined;
    let appliedReviveCount = engine?.reviveCount ?? 0;
    // Pursuit animation has its own vehicle. It can never transfer its pose to
    // an ordinary car when a traffic-pool entry is reused.
    const pursuitCar = new THREE.Group();
    pursuitCar.name = 'police-pursuit-vehicle';
    pursuitCar.visible = false;
    const collisionTraffic = new Map<THREE.Group, THREE.Vector3>();
    let launchSerial = 0,
      launchPulse = 0;
    let anchors = particleAnchors(bike.body, player.bike);
    const exhaustPosition = new THREE.Vector3(),
      tailPosition = new THREE.Vector3();
    const particles = mode === 'ride' ? createRideParticles(scene, low) : null;
    const policeCrashEffect = mode === 'ride'
      ? createPoliceCrashEffect(el, engine?.policeImpact.serial ?? 0)
      : null;
    const signs =
      mode === 'ride' ? makeSignCollectibleView(8, LANE, low) : null;
    if (signs) scene.add(signs.root);
    let crashNotified = false;
    let crashReported = false;
    let shadowFloor: THREE.Mesh | undefined;
    const fitPreviewGround = (_model: Player['bike']) => {
      if (!shadowFloor) return;
      shadowFloor.position.y = -0.015;
      sunlight.shadow.normalBias = 0.015;
      // Fit the receiving plane to the actual tires, independently of the
      // mechanical geometry. A large shadow bias made the preview float.
      bike.root.updateMatrixWorld(true);
      let contactY = Infinity;
      for (const wheel of bike.wheels) {
        const tire = wheel.getObjectByName('tire') ?? wheel;
        if (tire)
          // The settled swingarm rotates the rear wheel. A rotated bounding
          // box extends below a round tyre; use its actual vertices here.
          contactY = Math.min(contactY, new THREE.Box3().setFromObject(tire, true).min.y);
      }
      if (Number.isFinite(contactY)) shadowFloor.position.y = contactY - 0.0005;
      sunlight.shadow.normalBias = 0.002;
    };
    if (mode === 'ride') {
      worldView = makeWorldView(scene, low);
      const policeVariants = makeTrafficVariants('police');
      policeVariants.forEach(applyCartoonStyle);
      variantSets.set('police', policeVariants);
      pursuitCar.add(policeVariants[0].clone(true));
      scene.add(pursuitCar);
      for (let i = 0; i < 32; i++) {
        const group = new THREE.Group();
        group.name = `traffic-pool-${i}`;
        group.visible = false;
        scene.add(group);
        traffic.push(group);
      }
    } else {
      scene.background = new THREE.Color('#323232');
      scene.fog = null;
      shadowFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.ShadowMaterial({ opacity: 0.18 }),
      );
      shadowFloor.rotation.x = -Math.PI / 2;
      shadowFloor.position.y = -0.015;
      shadowFloor.receiveShadow = true;
      shadowFloor.name = 'neutral-preview-shadow-floor';
      scene.add(shadowFloor);
      fitPreviewGround(player.bike);
    }
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      invalidation.invalidate();
      renderer.setSize(w, h, false);
      heroOutline.update(w, h);
      particles?.setViewport(h, renderer.getPixelRatio());
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (mode === 'garage')
        transitionPreview(performance.now(), appliedFocus);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    if (mode !== 'ride') {
      const initial = previewTargets(mode === 'garage' ? appliedFocus : 'model', rotation);
      camera.position.copy(initial.position);
      previewLook.copy(initial.look);
      camera.lookAt(previewLook);
    }
    const manualZoom = (factor: number) => {
      if (mode === 'ride') return;
      invalidation.invalidate();
      cameraTransition = undefined;
      const next = THREE.MathUtils.clamp(zoom * factor, 0.55, 1.65);
      camera.position.sub(previewLook).multiplyScalar(next / zoom).add(previewLook);
      zoom = next;
    };
    zoomPreview.current = manualZoom;
    const down = (e: PointerEvent) => {
      if (mode === 'ride' || (e.target instanceof Element && e.target.closest('button'))) return;
      cameraTransition = undefined;
      dragging = true;
      previousX = e.clientX;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (dragging) {
        invalidation.invalidate();
        rotation += (e.clientX - previousX) * 0.009;
        previousX = e.clientX;
      }
    };
    const up = () => {
      dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      if (mode === 'ride' || (!e.ctrlKey && document.activeElement !== el)) return;
      e.preventDefault();
      manualZoom(Math.exp(e.deltaY * 0.001));
    };
    const keyDown = (e: KeyboardEvent) => {
      if (mode === 'ride' || e.target !== el) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        invalidation.invalidate();
        cameraTransition = undefined;
        rotation += e.key === 'ArrowLeft' ? -0.16 : 0.16;
      } else if (e.key === '+' || e.key === '-' || e.key === '=') {
        e.preventDefault();
        manualZoom(e.key === '-' ? 1.12 : 1 / 1.12);
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('keydown', keyDown);
    let graphicsAvailable = true;
    const contextLost = (e: Event) => {
      e.preventDefault();
      graphicsAvailable = false;
      engine?.pause();
      setError(
        '3D-Grafik wurde angehalten. Lade die Seite neu. Abgeschlossene Fahrten sind gespeichert.',
      );
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    let raf = 0,
      last = performance.now(),
      hud = 0,
      clock = 0;
    let tutorialAt = -Infinity;
    let tutorialCue: TutorialCue | null = null;
    let tutorialTarget: TutorialTarget | null = null;
    const tutorialPoint = new THREE.Vector3();
    const tutorialViewPoint = new THREE.Vector3();
    const projectTutorialTarget = (target: TutorialTarget) => {
      if (target.source === 'obstacle' && !traffic[target.index]?.visible) return null;
      if (target.source === 'sign' && !signs?.root.children[target.index]?.visible) return null;
      if (target.source === 'pursuit' && !pursuitCar.visible) return null;
      tutorialPoint.set(target.x, target.y, target.z);
      tutorialViewPoint.copy(tutorialPoint).applyMatrix4(camera.matrixWorldInverse);
      tutorialPoint.project(camera);
      return { x: (tutorialPoint.x + 1) / 2, y: (1 - tutorialPoint.y) / 2,
        depth: -tutorialViewPoint.z, clipZ: tutorialPoint.z };
    };
    const publishTutorialCue = (next: TutorialCue | null) => {
      if (next?.id === tutorialCue?.id && (!next || (tutorialCue &&
          Math.abs(next.x - tutorialCue.x) < .002 && Math.abs(next.y - tutorialCue.y) < .002))) return;
      tutorialCue = next;
      tutorial.current.callback?.(next);
    };
    let callbackReady = false;
    let focused = document.hasFocus(),
      visible = !document.hidden;
    const visualBlur = () => {
      focused = false;
      invalidation.invalidate();
    };
    const visualFocus = () => {
      focused = true;
      invalidation.invalidate();
      last = performance.now();
    };
    const visualVisibility = () => {
      visible = !document.hidden;
      invalidation.invalidate();
      last = performance.now();
    };
    window.addEventListener('blur', visualBlur);
    window.addEventListener('focus', visualFocus);
    document.addEventListener('visibilitychange', visualVisibility);
    let drawnPlayer = player;
    let drawnProducts = products;
    let drawnPhase = engine?.phase;
    let drawnHints = tutorial.current.seen;
    let drawnReducedMotion = reducedMotion();
    const renderCadence = createRenderCadence();
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.1);
      if (!graphicsAvailable) { last = now; return; }
      let crashComplete = false;
      const nextAppearance = appearance.current;
      const command = inspection.current;
      const reduceMotion = reducedMotion();
      const latestAssetReady = importedBikeReady(nextAppearance.player.bike);
      if (nextAppearance.player !== drawnPlayer || nextAppearance.products !== drawnProducts ||
          (latestAssetReady && nextAppearance.key !== vehicleKey) ||
          engine?.phase !== drawnPhase || tutorial.current.seen !== drawnHints ||
          reduceMotion !== drawnReducedMotion || command.inspectionFocus !== appliedFocus ||
          command.inspectionAngle !== appliedAngle || command.inspectionRevision !== appliedRevision) {
        invalidation.invalidate();
      }
      const continuous = mode === 'ride'
        ? engine?.phase === 'playing' || (engine?.resumeRemaining ?? 0) > 0 ||
          (engine?.phase === 'crashed' && !crashNotified && focused && visible)
        : !!cameraTransition || (mode === 'menu' && !dragging && !reduceMotion && appliedAngle === undefined);
      // Keep the last complete image while idle. Resume countdowns, crashes and
      // riding still advance every frame; controls and late artwork invalidate.
      const changed = continuous || invalidation.consume();
      if (callbackReady && !continuous && !changed) { last = now; return; }
      if (!renderCadence.accept(now, continuous)) return;
      // Skipped display callbacks accumulate into this unchanged elapsed dt.
      // Engine.advance still executes its deterministic 60 Hz fixed steps.
      last = now;
      drawnPlayer = nextAppearance.player;
      drawnProducts = nextAppearance.products;
      drawnPhase = engine?.phase;
      drawnHints = tutorial.current.seen;
      drawnReducedMotion = reduceMotion;
      clock += dt;
      // An asset request can finish out of order. Only the current appearance
      // can enter this scene; the previous preview stays visible while loading.
      if (!latestAssetReady && mode === 'ride') return;
      if (
        latestAssetReady && (nextAppearance.key !== vehicleKey ||
        nextAppearance.products !== vehicleProducts)
      ) {
        let replacement: ReturnType<typeof makeBike>;
        try {
          replacement = makeBike(nextAppearance.player, nextAppearance.products);
          applyStickersSafely(replacement, nextAppearance.player);
          applyCartoonHeroStyle(replacement.root);
        } catch (reason) {
          graphicsAvailable = false;
          setError(reason instanceof Error ? reason.message : 'Vorschau konnte nicht aktualisiert werden.');
          return;
        }
        scene.remove(bike.root);
        heroOutline.dispose();
        disposeVehicle(bike.root);
        bike = replacement;
        heroOutline = createCartoonOutline(bike.root);
        heroOutline.update(el.clientWidth, el.clientHeight);
        bike.root.name = 'player-bike';
        crash = undefined;
        crashTravel = undefined;
        impactTraffic = undefined;
        collisionTraffic.clear();
        anchors = particleAnchors(bike.body, nextAppearance.player.bike);
        scene.add(bike.root);
        invalidation.track(bike.root);
        fitPreviewGround(nextAppearance.player.bike);
        updateGlow = createGarmentGlowUpdater(bike.root);
        updateHeadlightGlow = createBikeHeadlightGlowUpdater(bike.body);
        updateColors = createPreviewColorUpdater(bike.body, bike.rider, nextAppearance.player);
        headlightRig = createBikeHeadlightRig(
          headlightModel(nextAppearance.player.bike),
        );
        vehicleKey = nextAppearance.key;
        vehicleProducts = nextAppearance.products;
        if (mode === 'garage') transitionPreview(now, appliedFocus);
      }
      if (latestAssetReady && updateColors(nextAppearance.player)) {
        applyCartoonHeroStyle(bike.root);
        invalidation.track(bike.root);
      }
      if (mode === 'garage' && command.inspectionFocus !== appliedFocus) {
        appliedFocus = command.inspectionFocus;
        transitionPreview(now, appliedFocus, focusAngles[appliedFocus]);
      }
      if (
        command.inspectionAngle !== appliedAngle ||
        command.inspectionRevision !== appliedRevision
      ) {
        appliedAngle = command.inspectionAngle;
        appliedRevision = command.inspectionRevision;
        if (appliedAngle !== undefined) {
          if (mode === 'garage') transitionPreview(now, appliedFocus, appliedAngle);
          else rotation = appliedAngle;
        }
      }
      if (engine && mode === 'ride') {
        if (engine.reviveCount !== appliedReviveCount) {
          appliedReviveCount = engine.reviveCount;
          restoreRidePose?.();
          restoreRidePose = undefined;
          crash = undefined;
          crashTravel = undefined;
          impactTraffic = undefined;
          collisionTraffic.clear();
          crashNotified = crashReported = false;
          tilt = suspension = landing = launchPulse = 0;
          previousSpeed = engine.speed;
          previousXPosition = engine.x;
          previousLateralSpeed = 0;
          bike.root.position.set(engine.x, 0, 0);
          bike.root.rotation.set(0, 0, 0);
          bike.animateSuspension(0, 0);
          bike.animateRider({ wheelie: 0, steer: 0, landing: 0 }, 1);
          camera.position.set(engine.x * 0.27, 4.4, camera.aspect < 0.8 ? 10.4 : 8.4);
          camera.lookAt(engine.x * 0.38, 1.4, -12);
          hud = 1;
        }
        engine.advance(dt);
        const moving = engine.phase === 'playing';
        const crashed =
          engine.phase === 'crashed' && engine.event.text !== 'Ride ended';
        const crashActive = focused && visible;
        const rearImpact =
          !!engine.policeRamObstacle &&
          engine.crashObstacle === engine.policeRamObstacle;
        const hitKind = TRAFFIC_KINDS.find(
          (kind) => kind === engine.crashObstacle?.kind,
        );
        const solidImpact =
          !!engine.crashObstacle &&
          (!!hitKind || engine.crashObstacle.kind === 'barrier');
        const sideImpact =
          hitKind &&
          engine.crashObstacle!.z <
            TRAFFIC_SHAPES[hitKind].rearZ +
              trafficFrontReach(
                engine.bike.id,
                Math.max(engine.towPitch, engine.wheelieAngle),
              ) - 0.05;
        const impactDirection: CrashDirection = rearImpact
          ? 'rear'
          : solidImpact
            ? sideImpact
              ? 'side'
              : 'front'
            : 'fall';
        const impactLateralVelocity = previousLateralSpeed;
        let longitudinalAcceleration = 0,
          lateralAcceleration = 0;
        if (crashed && !crashTravel)
          crashTravel = createCrashTravel(
            engine.speed,
            impactDirection,
            appearance.current.player.settings.reducedMotion,
          );
        // Freeze solid traffic at the exact contact pose before advancing the
        // presentation. Applying this frame's coast first embeds its bumper
        // in the bike and causes a visible separation jump on impact.
        crashTravel?.advance(dt, crashed && crashActive && !!crash);
        const distance = engine.distance + (crashTravel?.distance ?? 0);
        worldView!.update(engine.world, distance);
        worldView!.updateSpeedCamera(
          engine.speedCamera,
          distance,
          engine.phase !== 'crashed' && engine.blitzerFlashRemaining > 0
            ? Math.min(1, engine.blitzerFlashRemaining * 5)
            : 0,
        );
        const darkness = lighting!.update(
          engine.world,
          distance,
          engine.x,
          headlightRig.count,
        );
        updateGlow(darkness);
        updateHeadlightGlow(darkness);
        if (!crash) bike.root.position.set(engine.x, engine.height, 0);
        if (moving) {
          if (engine.landingSerial !== landingSerial) {
            landingSerial = engine.landingSerial;
            landing = Math.min(1, engine.landingSpeed / 6.5);
          } else landing *= Math.exp(-dt * 9);
          const frontLift = Math.min(
            1,
            engine.wheelieAngle / engine.balanceProfile.balancePoint,
          );
          tilt = engine.onTowTruck
            ? engine.towPitch
            : Math.max(
                engine.towPitch,
                Math.min(
                  engine.wheelieAngle,
                  TAIL_CONTACT[appearance.current.player.bike].angle,
                ),
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
          const lanePose = wheelieLanePose({
            age: engine.laneChangeAge,
            direction: engine.laneChangeDirection,
            wheelie: engine.wheelie ? frontLift : 0,
            airborne: engine.height > 0,
            onTowTruck: engine.onTowTruck,
            reducedMotion: appearance.current.player.settings.reducedMotion,
          });
          const balancing = engine.wheelie
            ? Math.sin(engine.elapsed * 3.5) * 0.045 * frontLift +
              steering * 0.28
            : steering;
          const drift =
            !engine.wheelie && engine.height === 0
              ? engine.laneChangeDirection *
                Math.sin(Math.min(1, engine.laneChangeAge / 0.32) * Math.PI)
              : 0;
          const compression = suspensionTarget({
            landing,
            launch,
            forward: engine.forwardLoad,
            road,
            roughness: engine.roadRoughness,
            airborne: engine.height > 0 && !engine.onTowTruck,
          });
          if (engine.onTowTruck) suspension = 0;
          else
            suspension += (compression - suspension) * (1 - Math.exp(-dt * 18));
          bike.root.rotation.z = THREE.MathUtils.lerp(
            bike.root.rotation.z,
            appearance.current.player.settings.reducedMotion ||
              engine.onTowTruck
              ? 0
              : -balancing * 0.16 - drift * 0.026 + lanePose.roll,
            1 - Math.exp(-dt * 12),
          );
          bike.root.rotation.y = appearance.current.player.settings
            .reducedMotion
            ? 0
            : drift * 0.105 + lanePose.yaw;
          bike.animateRider(
            {
              wheelie: frontLift,
              forward: engine.forwardLoad,
              steer: balancing + lanePose.steer,
              handlebarSteer: handlebarSteeringInput(
                steering, engine.laneChangeAge, engine.laneChangeDirection,
                engine.wheelie ? frontLift : 0, engine.elapsed, balance,
                appearance.current.player.settings.reducedMotion,
              ),
              bikePitch: tilt,
              bikeRoll: bike.root.rotation.z,
              landing,
              launch,
              balance,
              load,
              road,
            },
            dt,
          );
        }
        if (!moving) previousLateralSpeed = 0;
        previousXPosition = engine.x;
        const policePose = engine.policeVehicle;
        pursuitCar.visible = policePose.visible;
        pursuitCar.position.set(
          policePose.x,
          policePose.y,
          -policePose.z +
            (crashTravel?.distance ?? 0) -
            policePose.velocity * (crashTravel?.elapsed ?? 0),
        );
        pursuitCar.rotation.set(
          policePose.pitch,
          policePose.yaw,
          policePose.roll,
        );
        const frozenPolice = collisionTraffic.get(pursuitCar);
        if (crashed && frozenPolice) pursuitCar.position.copy(frozenPolice);
        animateTraffic(pursuitCar, policePose.velocity, moving ? dt : 0);
        engine.obstacles.forEach((o, i) => {
          const group = traffic[i];
          if (group.userData.spawnId !== o.spawnId) {
            collisionTraffic.delete(group);
            group.userData.spawnId = o.spawnId;
          }
          group.visible = o.active;
          group.rotation.set(0, trafficYaw(o.velocity, o.laneShift), 0);
          group.scale.set(1, 1, 1);
          if (!o.active) {
            // Pooled groups may later represent a different vehicle. Never
            // carry a police-impact freeze into that recycled slot.
            collisionTraffic.delete(group);
            return;
          }
          group.position.set(
            o.lane * LANE + o.offsetX,
            0,
            -o.z +
              (crashTravel?.distance ?? 0) -
              o.velocity * (crashTravel?.elapsed ?? 0),
          );
          const frozen = collisionTraffic.get(group);
          if (frozen && crashed) group.position.copy(frozen);
          const modelKind = o.police ? 'police' : o.kind;
          const key = `${modelKind}:${o.color}`;
          if (group.userData.key !== key) {
            group.clear();
            let template = templates.get(key);
            if (!template) {
              let variants = variantSets.get(modelKind);
              if (!variants) {
                variants = makeTrafficVariants(modelKind);
                variants.forEach(applyCartoonStyle);
                variantSets.set(modelKind, variants);
              }
              template = variants[o.color] ?? variants[0];
              templates.set(key, template);
            }
            group.add(template.clone(true));
            group.userData.key = key;
          }
          animateTraffic(
            group,
            Math.abs(o.velocity),
            moving || (crashed && crashActive) ? dt : 0,
            o.laneShift,
          );
        });
        if (crashed) {
          if (!crash) {
            restoreRidePose = captureRidePose(bike.root);
            tilt = Math.min(
              engine.wheelieAngle,
              TAIL_CONTACT[appearance.current.player.bike].angle,
            );
            bike.animateSuspension(tilt, suspension);
            const impactIndex = engine.obstacles.indexOf(engine.crashObstacle!);
            impactTraffic =
              engine.crashObstacle === engine.policeRamObstacle
                ? pursuitCar
                : impactIndex >= 0
                  ? traffic[impactIndex]
                  : undefined;
            if (impactTraffic?.visible && solidImpact) {
              impactTraffic.updateWorldMatrix(true, true);
            } else {
              impactTraffic = undefined;
            }
            // Lock nearby solid traffic at its impact pose while the short
            // crash simulation resolves rider and motorcycle contacts.
            engine.obstacles.forEach((obstacle, index) => {
              const group = traffic[index];
              if (
                group.visible &&
                Math.abs(group.position.z) < 16 &&
                (TRAFFIC_KINDS.some((kind) => kind === obstacle.kind) ||
                  obstacle.kind === 'barrier')
              )
                collisionTraffic.set(group, group.position.clone());
            });
            if (pursuitCar.visible && Math.abs(pursuitCar.position.z) < 20)
              collisionTraffic.set(pursuitCar, pursuitCar.position.clone());
            crash = createCrashAnimation(bike, {
              cause: engine.event.text,
              pitch: tilt,
              travel: suspension,
              reducedMotion: appearance.current.player.settings.reducedMotion,
              impactObstacle: impactTraffic,
              collisionObstacles: [...collisionTraffic.keys()],
              impactSpeed: engine.speed,
              impactDirection,
              lateralVelocity: impactLateralVelocity,
            });
          }
          crashComplete = crash.advance(dt, crashActive);
        } else
          bike.animateSuspension(
            tilt,
            suspension,
            engine.onTowTruck
              ? 0
              : Math.min(
                  1,
                  engine.wheelieAngle / engine.balanceProfile.balancePoint,
                ),
          );
        // Final ordinary/crash pose: accessory gravity and both light endpoints
        // consume these same transforms before the scene is rendered.
        bike.animateAccessories(
          {
            speed: crashTravel?.speed ?? engine.speed,
            longitudinalAcceleration,
            lateralAcceleration,
            landing,
            paused:
              engine.phase === 'paused' ||
              engine.phase === 'ready' ||
              (crashed && (!crashActive || crashComplete)),
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
              ((crashTravel?.speed ?? engine.speed) * dt) / (wheel.userData.rollingRadius ?? 0.47);
        const shake =
          appearance.current.player.settings.reducedMotion || !moving
            ? 0
            : Math.sin(clock * 23) * 0.016;
        const portraitRide = camera.aspect < 0.8;
        const chaseZ = portraitRide ? 10.4 : 8.4;
        if (engine.phase !== 'paused') {
          camera.position.set(
            engine.x * 0.27 + shake,
            4.4 + engine.height * 0.13,
            chaseZ,
          );
          camera.lookAt(engine.x * 0.38, 1.4, -12);
          if (crash && !rearImpact) {
            const blend = crash.cameraBlend;
            camera.position.set(
              THREE.MathUtils.lerp(engine.x * 0.27, crash.focus.x, blend),
              THREE.MathUtils.lerp(
                4.4 + engine.height * 0.13,
                3.5,
                blend,
              ),
              THREE.MathUtils.lerp(chaseZ, 7.2, blend),
            );
            camera.lookAt(
              THREE.MathUtils.lerp(engine.x * 0.38, crash.focus.x, blend),
              THREE.MathUtils.lerp(1.4, crash.focus.y, blend),
              THREE.MathUtils.lerp(-12, crash.focus.z, blend),
            );
          }
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
        sky?.update(engine.world, distance, reducedMotion() ? 0 : engine.elapsed);
        // Observe already-rendered encounter models at most seven times per
        // second. React receives only changed viewport anchors, never frames.
        // An instructional pause retains its cue and does not discover another.
        if (tutorial.current.callback && callbackReady &&
            (now - tutorialAt >= 150 || (engine.phase === 'paused' && !continuous && changed))) {
          tutorialAt = now;
          camera.updateMatrixWorld(true);
          if (engine.phase === 'paused' && tutorialTarget) {
            // Orientation changes alter projection even while the simulation
            // stays frozen. Keep the same lesson; hide an offscreen ring only.
            const point = projectTutorialTarget(tutorialTarget);
            publishTutorialCue(visibleTutorialProjection(point)
              ? { id: tutorialTarget.id, x: point.x, y: point.y } : null);
          } else if (engine.phase !== 'paused') {
            let nextTarget: TutorialTarget | null = null;
            const cue = focused && visible ? selectTutorialCue(engine, tutorial.current.seen, (target) => {
              const point = projectTutorialTarget(target);
              if (visibleTutorialProjection(point)) nextTarget = target;
              return point;
            }) : null;
            tutorialTarget = cue ? nextTarget : null;
            publishTutorialCue(cue);
          }
        }
        policeCrashEffect?.update(
          engine.policeImpact, camera, distance, dt,
          focused && visible && engine.phase !== 'paused' && engine.phase !== 'ready',
          appearance.current.player.settings.reducedMotion,
        );
        hud += dt;
        if (hud > 0.075 || (engine.phase === 'crashed' && !crashReported)) {
          frameCallback.current?.(engine);
          if (engine.phase === 'crashed') crashReported = true;
          hud = 0;
        }
      } else {
        if (
          !dragging &&
          !reducedMotion() &&
          appliedAngle === undefined &&
          mode === 'menu'
        )
          rotation += dt * 0.04;
        if (cameraTransition) {
          const progress = reducedMotion() ? 1 : Math.min(1, (now - cameraTransition.start) / 240);
          const eased = progress * progress * (3 - 2 * progress);
          camera.position.lerpVectors(cameraTransition.from, cameraTransition.to, eased);
          previewLook.lerpVectors(cameraTransition.lookFrom, cameraTransition.lookTo, eased);
          rotation = THREE.MathUtils.lerp(cameraTransition.rotationFrom, cameraTransition.rotationTo, eased);
          if (progress === 1) cameraTransition = undefined;
        }
        bike.root.rotation.y = rotation;
        if (mode === 'menu') {
          const portrait = camera.aspect < 0.8;
          camera.position.set(0, 2.9, (portrait ? 8.8 : 7.4) * zoom);
          previewLook.set(0, 1.3, 0);
        }
        camera.lookAt(previewLook);
        bike.animateAccessories({ speed: 0, reducedMotion: true }, dt);
      }
      try {
        renderer.render(scene, camera);
      } catch (reason) {
        graphicsAvailable = false;
        engine?.pause();
        setError(reason instanceof Error ? reason.message : '3D-Vorschau ist nicht verfügbar.');
        return;
      }
      session.afterRender();
      if (crashComplete && !crashNotified) {
        crashNotified = true;
        crashCallback.current?.();
      }
      if (!callbackReady) {
        callbackReady = true;
        setRenderReady(true);
        readyCallback.current?.();
      }
    };
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      if (tutorialCue) tutorial.current.callback?.(null);
      policeCrashEffect?.dispose();
      observer.disconnect();
      window.removeEventListener('blur', visualBlur);
      window.removeEventListener('focus', visualFocus);
      document.removeEventListener('visibilitychange', visualVisibility);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('keydown', keyDown);
      zoomPreview.current = () => {};
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      sky?.dispose();
      heroOutline.dispose();
      disposeUnique(scene);
      disposeSkeletons(scene);
      particles?.dispose();
      signs?.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      const bikeMaterials = new Set<THREE.Material>();
      bike.root.traverse((o) => {
        if (o instanceof THREE.Mesh)
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            bikeMaterials.add(m),
          );
      });
      scene.traverse((o) => {
        if (
          o instanceof THREE.DirectionalLight ||
          o instanceof THREE.SpotLight ||
          o instanceof THREE.PointLight
        )
          o.shadow.dispose();
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
      variantSets.forEach((variants) =>
        variants.forEach((t) =>
          t.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              geometries.add(o.geometry);
              (Array.isArray(o.material) ? o.material : [o.material]).forEach(
                (m) => mats.add(m),
              );
            }
          }),
        ),
      );
      geometries.forEach((g) => g.dispose());
      mats.forEach((m) => {
        if (!bikeMaterials.has(m)) m.dispose();
      });
      // Only per-bike materials survive briefly, keeping their shader references.
      // Scene geometry, particles, traffic and shadow maps are released now.
      session.release(() => bikeMaterials.forEach((m) => m.dispose()));
    };
  }, [mode, engine, quality, hasUsableAsset]);
  return (
    <div
      className={`scene scene-${mode}`}
      ref={host}
      tabIndex={mode === 'ride' ? undefined : 0}
      data-inspection-focus={inspectionFocus}
      aria-label={
        mode === 'ride'
          ? 'Dreispurige Motorradstrecke'
          : 'Interaktive Fahrer- und Motorrad-Vorschau'
      }
    >
      {!renderReady && !error && (
        mode === 'ride' ? <LoadingScreen label="STRECKE WIRD GELADEN" fullScreen /> : <PreviewLoading />
      )}
      {renderReady && assetLoading && !error && <output className="scene-load-note" aria-live="polite"><span className="spinner" aria-hidden="true" />Neues Modell wird geladen · bisherige Ansicht</output>}
      {mode === 'garage' && renderReady && !error && <div className="scene-zoom" aria-label="Vorschau vergrößern oder verkleinern">
        <button type="button" aria-label="Vorschau vergrößern" onClick={() => zoomPreview.current(1 / 1.12)}><Plus size={18} strokeWidth={3} aria-hidden="true" /></button>
        <button type="button" aria-label="Vorschau verkleinern" onClick={() => zoomPreview.current(1.12)}><Minus size={18} strokeWidth={3} aria-hidden="true" /></button>
      </div>}
      {error && mode !== 'ride' && <SceneFallback player={player} products={products} />}
      {error && mode === 'ride' && (
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
