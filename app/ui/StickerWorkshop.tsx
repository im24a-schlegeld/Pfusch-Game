import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Player, Product, StickerPlacement } from '../domain/types';
import { BIKES } from '../domain/config';
import { isSticker, MAX_STICKERS } from '../domain/stickers';
import { imagePath } from '../domain/preview';
import { digitalPrice } from '../domain/progression';
import { makeBike } from '../game/vehicle';
import { rendererSessions } from '../game/rendererSession';
import { applyBikeStickers, stickerSurfaces } from '../game/bikeStickers';
import './stickerWorkshop.css';

interface Props { player: Player; account: Player; products: Product[]; onClose: () => void; onBuySticker: () => void; onSave: (placements: StickerPlacement[]) => void }
/** Imported only after the explicit workshop action. No renderer or physics on garage entry. */
export default function StickerWorkshop({ player, account, products, onClose, onBuySticker, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [placements, setPlacements] = useState<StickerPlacement[]>(() => structuredClone(player.stickers[player.bike] ?? []));
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<'view' | 'place'>('view');
  const [size, setSize] = useState(0.18);
  const [rotation, setRotation] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('Drehe das Fahrzeug zur gewünschten Fläche.');
  const state = useRef({ placements, tool, size, rotation, selected });
  state.current = { placements, tool, size, rotation, selected };
  const view = useRef<((angle: number) => void) | null>(null);
  const product = products.find(isSticker);
  // Inventory updates independently of the frozen preview: buying must not reset
  // the camera, renderer or unsaved sticker positions.
  const stickerOwned = Boolean(product && (account.ownedItems.includes(product.id) || account.irlItems.includes(product.id)));
  const bikeOwned = account.ownedItems.includes(`bike:${player.bike}`);
  const owned = stickerOwned && bikeOwned;
  const price = product ? digitalPrice(product) : 0;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close.current(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el || !product) return;
    let session: ReturnType<typeof rendererSessions.acquire>;
    try { session = rendererSessions.acquire(player.settings.quality !== 'low'); }
    catch { setError('3D-Werkstatt konnte nicht gestartet werden. Bitte neu öffnen.'); return; }
    const { renderer, environment } = session;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    renderer.setClearColor('#323232'); renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.environment = environment.texture;
    scene.add(new THREE.HemisphereLight('#ffffff', '#323232', 2));
    const key = new THREE.DirectionalLight('#ffffff', 3); key.position.set(3, 5, -4); scene.add(key);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 30);
    const bike = makeBike(player, products); bike.rider.visible = false; scene.add(bike.root);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0); controls.minDistance = 2.2; controls.maxDistance = 7;
    controls.minPolarAngle = 0.3; controls.maxPolarAngle = Math.PI * 0.65; controls.enablePan = false;
    controls.enableDamping = true;
    view.current = (angle) => { camera.position.set(Math.sin(angle) * 4.8, 2.35, Math.cos(angle) * 4.8); controls.update(); };
    view.current(Math.PI / 2);
    const resize = () => { if (!el.clientWidth || !el.clientHeight) return; renderer.setSize(el.clientWidth, el.clientHeight, false); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const ray = new THREE.Raycaster();
    let down: [number, number] | undefined;
    const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const pointerUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 8 || state.current.tool !== 'place') { down = undefined; return; }
      down = undefined;
      const surfaces = stickerSurfaces(bike.body, bike.rider, player.paint);
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      bike.root.updateWorldMatrix(true, true);
      const visible: THREE.Mesh[] = [];
      const collect = (object: THREE.Object3D) => {
        if (!object.visible || object === bike.rider || object.userData.bikeSticker) return;
        if (object instanceof THREE.Mesh) visible.push(object);
        object.children.forEach(collect);
      };
      collect(bike.body);
      const hit = ray.intersectObjects(visible, false)[0];
      if (!hit?.face) { setHint('Bitte eine lackierte Verkleidung oder den Tank antippen.'); return; }
      const surface = [...surfaces].find(([, mesh]) => mesh === hit.object)?.[0];
      if (!surface) { setHint('Hier sitzt ein Bauteil. Wähle eine freie lackierte Fläche.'); return; }
      const current = state.current;
      if (!current.selected && current.placements.length >= MAX_STICKERS) { setHint(`Maximal ${MAX_STICKERS} Sticker pro Fahrzeug.`); return; }
      const id = current.selected ?? crypto.randomUUID();
      const placement: StickerPlacement = { id, productId: product.id, surface, point: hit.object.worldToLocal(hit.point.clone()).toArray(), normal: hit.face.normal.clone().normalize().toArray(), size: current.size, rotation: current.rotation };
      setPlacements((previous) => current.selected ? previous.map((p) => p.id === id ? placement : p) : [...previous, placement]);
      setSelected(id); setHint('Position gesetzt. Größe und Drehung kannst du unten anpassen.');
    };
    const lost = (event: Event) => { event.preventDefault(); setError('Grafik angehalten. Schließe und öffne die Werkstatt erneut.'); };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('webglcontextlost', lost);
    let raf = 0, lastPlacements: StickerPlacement[] | undefined;
    const render = () => {
      raf = requestAnimationFrame(render);
      controls.enabled = state.current.tool === 'view'; controls.update();
      if (lastPlacements !== state.current.placements) {
        applyBikeStickers(bike.body, bike.rider, player.paint, state.current.placements);
        lastPlacements = state.current.placements;
      }
      renderer.render(scene, camera); session.afterRender();
    };
    render(); setReady(true);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); view.current = null;
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      bike.root.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
        if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m)); }
      });
      geometries.forEach((g) => g.dispose()); renderer.domElement.remove();
      session.release(() => materials.forEach((m) => m.dispose()));
    };
  }, [player, products, product]);
  function change(value: number, field: 'size' | 'rotation') {
    if (field === 'size') setSize(value); else setRotation(value);
    if (selected) setPlacements((previous) => previous.map((p) => p.id === selected ? { ...p, [field]: value } : p));
  }
  return <main className="sticker-workshop" aria-label="Sticker-Werkstatt">
    <header><button className="button small" onClick={onClose}>ZURÜCK</button><div><p className="eyebrow">DEIN FAHRZEUG. DEINE POSITION.</p><h1>STICKER-WERKSTATT</h1></div><span>{BIKES.find((b) => b.id === player.bike)?.name}</span></header>
    <div className="sticker-stage" ref={host} data-testid="sticker-stage">
      {!ready && !error && <div className="scene-loading"><span className="spinner"/>SIMULATION WIRD GELADEN</div>}
      {error && <p className="graphics-error" role="alert">{error}</p>}
    </div>
    <section className="sticker-tools">
      <div className="sticker-tools-top"><div className="sticker-mode"><button aria-pressed={tool === 'view'} onClick={() => setTool('view')}>FAHRZEUG DREHEN</button><button disabled={!ready} aria-pressed={tool === 'place'} onClick={() => { setTool('place'); setHint('Tippe die gewünschte Stelle an.'); }}>STICKER PLATZIEREN</button></div>
        <div className="sticker-views">{[['LINKS', -Math.PI / 2], ['VORNE', Math.PI], ['RECHTS', Math.PI / 2], ['HINTEN', 0]].map(([label, angle]) => <button key={String(label)} onClick={() => view.current?.(Number(angle))}>{label}</button>)}</div></div>
      <output className="sticker-hint">{hint}</output>
      <div className="sticker-adjust"><label>GRÖSSE <input aria-label="Stickergröße" type="range" min="0.04" max="0.4" step="0.01" value={size} onChange={(e) => change(Number(e.target.value), 'size')}/></label><label>DREHUNG <input aria-label="Stickerdrehung" type="range" min={-Math.PI} max={Math.PI} step="0.05" value={rotation} onChange={(e) => change(Number(e.target.value), 'rotation')}/></label></div>
      <div className="sticker-items" aria-label="Platzierte Sticker">{placements.map((p, index) => <button key={p.id} aria-pressed={selected === p.id} onClick={() => { setSelected(p.id); setSize(p.size); setRotation(p.rotation); setTool('place'); setHint(`Sticker ${index + 1} ausgewählt. Du kannst ihn unten entfernen.`); }}>STICKER {index + 1}</button>)}<button disabled={placements.length >= MAX_STICKERS} onClick={() => { setSelected(null); setTool('place'); setHint('Tippe eine Fläche für den nächsten Sticker an.'); }}>+ NEUER STICKER</button>{selected && <button aria-label="Ausgewählten Sticker entfernen" onClick={() => { setPlacements((p) => p.filter((s) => s.id !== selected)); setSelected(null); setHint('Sticker entfernt. Zum Übernehmen unten speichern.'); }}>STICKER ENTFERNEN</button>}</div>
      <div className="sticker-footer">{product && <a href={product.url} target="_blank" rel="noreferrer"><img src={imagePath(product.localImage ?? product.image)} alt={product.title}/><span>{product.title}<small>ORIGINAL IM SHOP</small></span></a>}<div>
        {product && !stickerOwned && <div className="sticker-purchase">
          <p>Digitaler Sticker · Guthaben: {account.coins.toLocaleString('de-CH')} Coins</p>
          <button className="button" disabled={account.coins < price} onClick={onBuySticker}>STICKER KAUFEN · {price} COINS</button>
          {account.coins < price && <p>Dir fehlen {price - account.coins} Coins.</p>}
        </div>}
        {!bikeOwned && <p>Kostenlose Vorschau · Zum Speichern dieses Fahrzeug zuerst in der Garage freischalten.</p>}
        {stickerOwned && <p>Sticker freigeschaltet · Platzierung mit Speichern übernehmen.</p>}
        <button className="button primary" disabled={!owned || !ready || Boolean(error)} onClick={() => onSave(placements)}>POSITIONEN SPEICHERN & ANWENDEN</button>
      </div></div>
    </section>
  </main>;
}
