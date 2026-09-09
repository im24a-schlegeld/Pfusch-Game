import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import type { Player, Product } from '../domain/types';
import { Engine, LANE } from './engine';
import { box, disposeUnique, makeTraffic, sign } from './models';
import { makeBike } from './vehicle';

interface Props {
  player: Player;
  products: Product[];
  mode: 'menu' | 'garage' | 'ride';
  engine?: Engine;
  onFrame?: (engine: Engine) => void;
  onReady?: () => void;
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
  inspectionAngle,
  inspectionRevision,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const frameCallback = useRef(onFrame);
  const readyCallback = useRef(onReady);
  const [error, setError] = useState('');
  const appearance=useRef({player,products,key:''});
  appearance.current={player,products,key:JSON.stringify([player.bike,player.paint,player.rims,player.equipped,player.variants,player.customizations])};
  const inspection=useRef({inspectionAngle,inspectionRevision});
  inspection.current={inspectionAngle,inspectionRevision};
  const quality=player.settings.quality;
  frameCallback.current = onFrame;
  readyCallback.current = onReady;
  useEffect(() => {
    const {player,products}=appearance.current;
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
    renderer.setClearColor(mode === 'ride' ? '#8d999b' : '#181d1f');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = mode !== 'ride';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const studio=new RoomEnvironment();const environmentGenerator=new THREE.PMREMGenerator(renderer);const environment=environmentGenerator.fromScene(studio,.04);scene.environment=environment.texture;scene.environmentIntensity=.7;studio.dispose();environmentGenerator.dispose();
    scene.fog = new THREE.Fog(
      mode === 'ride' ? '#8d999b' : '#181d1f',
      mode === 'ride' ? 55 : 16,
      mode === 'ride' ? 158 : 65,
    );
    const camera = new THREE.PerspectiveCamera(
      mode === 'ride' ? 61 : 40,
      1,
      0.1,
      190,
    );
    scene.add(new THREE.HemisphereLight('#e3f0f2', '#343a2f', 1.4));
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
    let vehicleKey=appearance.current.key,vehicleProducts=products;
    scene.add(bike.root);
    const scenery: THREE.Group[] = [];
    const roadMarks: THREE.Mesh[] = [];
    const traffic: THREE.Group[] = [];
    const templates = new Map<string, THREE.Group>();
    let appliedAngle=inspection.current.inspectionAngle,appliedRevision=inspection.current.inspectionRevision;
    let rotation = appliedAngle ?? 2.35;
    let dragging = false;
    let previousX = 0;
    let tilt = 0;
    if (mode === 'ride') {
      box(scene, 260, 0.15, 360, 0, -0.23, -75, '#626e65');
      box(scene, 9.6, 0.16, 340, 0, -0.09, -75, '#3b4448');
      for (const x of [-5.3, 5.3]) {
        box(scene, 1.1, 0.28, 340, x, 0.02, -75, '#9aa299');
        box(scene, 0.08, 0.01, 340, x < 0 ? -4.5 : 4.5, 0.012, -75, '#ccd0bd');
      }
      for (let i = 0; i < 28; i++)
        for (const x of [-LANE / 2, LANE / 2])
          roadMarks.push(
            box(scene, 0.09, 0.012, 3.8, x, 0.012, -i * 7, '#dddccc'),
          );
      for (let i = 0; i < 18; i++) {
        const group = new THREE.Group();
        group.position.z = -i * 12;
        scene.add(group);
        scenery.push(group);
        for (const side of [-1, 1]) {
          const h = 4 + ((i * 7) % 11);
          box(
            group,
            4 + (i % 3),
            h,
            9,
            side * (11 + (i % 3)),
            h / 2,
            -1,
            i % 3 === 0 ? '#606c6c' : i % 3 === 1 ? '#4c595c' : '#7d8780',
          );
          if (!low)
            for (let k = 0; k < 3; k++)
              box(
                group,
                0.025,
                0.7,
                1.2,
                side * (8.8 + (i % 3)),
                2 + k * 2,
                -1,
                '#b5b8a1',
              );
          box(group, 0.1, 5.6, 0.1, side * 6.1, 2.8, 0, '#303a3d');
          box(
            group,
            side < 0 ? 1.7 : 1.7,
            0.11,
            0.22,
            side * 5.35,
            5.55,
            0,
            '#d4d6c3',
          );
          if (i % 3 === 0)
            box(group, 0.32, 0.7, 0.4, side * 5.6, 0.42, 4, '#d9d5b2');
        }
        if (i === 5 || i === 14) {
          box(group, 13, 0.7, 6, 0, 6.9, 0, '#505c5d');
          for (const side of [-1, 1])
            box(group, 0.7, 7, 6, side * 6.2, 3.5, 0, '#505c5d');
        }
        if (i === 8 || i === 17) {
          const board = sign('CAN YOU KEEP UP?');
          board.position.set(-10, 4, 2);
          board.rotation.y = 0.25;
          group.add(board);
        }
      }
      for (let i = 0; i < 32; i++) {
        const group = new THREE.Group();
        group.visible = false;
        scene.add(group);
        traffic.push(group);
      }
      for (const kind of ['car', 'van', 'barrier', 'ramp'])
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
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      clock += dt;
      const nextAppearance=appearance.current;
      if(nextAppearance.key!==vehicleKey||nextAppearance.products!==vehicleProducts){
        scene.remove(bike.root);disposeVehicle(bike.root);
        bike=makeBike(nextAppearance.player,nextAppearance.products);scene.add(bike.root);
        vehicleKey=nextAppearance.key;vehicleProducts=nextAppearance.products;
      }
      const command=inspection.current;
      if(command.inspectionAngle!==appliedAngle||command.inspectionRevision!==appliedRevision){
        appliedAngle=command.inspectionAngle;appliedRevision=command.inspectionRevision;
        if(appliedAngle!==undefined)rotation=appliedAngle;
      }
      if (engine && mode === 'ride') {
        engine.advance(dt);
        const moving = engine.phase === 'playing';
        const distance = engine.distance;
        bike.root.position.set(engine.x, engine.height, 0);
        tilt += (Number(engine.wheelie) * 0.48 - tilt) * Math.min(1, dt * 9);
        bike.body.rotation.x = tilt;
        bike.body.position.y =
          bike.wheelRadius * (1 - Math.cos(tilt)) +
          bike.rearAxle * Math.sin(tilt);
        bike.root.rotation.z = THREE.MathUtils.lerp(
          bike.root.rotation.z,
          (engine.lane * LANE - engine.x) * -0.09,
          dt * 12,
        );
        if (moving)
          for (const wheel of bike.wheels)
            wheel.rotation.x -= (engine.speed * dt) / 0.47;
        roadMarks.forEach((m, i) => {
          m.position.z =
            10 - ((((Math.floor(i / 2) * 7 - distance) % 196) + 196) % 196);
        });
        scenery.forEach((group, i) => {
          group.position.z = 16 - ((((i * 12 - distance) % 216) + 216) % 216);
        });
        engine.obstacles.forEach((o, i) => {
          const group = traffic[i];
          group.visible = o.active;
          if (!o.active) return;
          group.position.set(o.lane * LANE, 0, -o.z);
          const key = `${o.kind}:${o.color}`;
          if (group.userData.key !== key) {
            group.clear();
            group.add(templates.get(key)!.clone(true));
            group.userData.key = key;
          }
        });
        const shake =
          appearance.current.player.settings.reducedMotion || !moving
            ? 0
            : Math.sin(clock * 23) * 0.016;
        camera.position.set(
          engine.x * 0.27 + shake,
          4.4 + engine.height * 0.13,
          8.4,
        );
        camera.lookAt(engine.x * 0.38, 1.4, -12);
        const fov = 61 + (engine.speed - 22) * 0.22;
        if (Math.abs(camera.fov - fov) > 0.05) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        hud += dt;
        if (hud > 0.075 || engine.phase === 'crashed') {
          frameCallback.current?.(engine);
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
      }
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        readyCallback.current?.();
      }
    };
    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      disposeUnique(scene);
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
          if (o instanceof THREE.Mesh) geometries.add(o.geometry);
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
function disposeVehicle(root:THREE.Object3D){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
 root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}
