import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Player, Product, StickerPlacement } from '../domain/types';
import { BIKES } from '../domain/config';
import { DEFAULT_STICKER_SIZE, helmetStickerTarget, isSticker, MAX_STICKERS, ownsStickerTarget, stickerEditPrice, stickerMaxSize } from '../domain/stickers';
import { HELMETS } from '../domain/helmet';
import { imagePath } from '../domain/preview';
import { digitalPrice } from '../domain/progression';
import { makeBike } from '../game/vehicle';
import { importedBikeReady, preloadImportedBike } from '../game/importedBikeAsset';
import { rendererSessions } from '../game/rendererSession';
import { adjustStickerPlacement, applyBikeStickers, applyHelmetStickers, helmetStickerSurfaces, stickerHelmet, stickerSurfaces } from '../game/bikeStickers';
import './stickerWorkshop.css';
import './stickerWorkshopUpdate.css';
import './stickerWorkshopV9.css';

type Target = 'bike' | 'helmet';
const emptyPlacements: StickerPlacement[] = [];
interface Props { player: Player; account: Player; products: Product[]; initialTarget?: Target; onClose: () => void; onSave: (drafts: Record<string, StickerPlacement[]>) => boolean | Promise<boolean> }
/** Imported only after the explicit workshop action. No renderer or physics on garage entry. */
export default function StickerWorkshop({ player, account, products, initialTarget = 'bike', onClose, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target>(initialTarget);
  const [drafts, setDrafts] = useState<Record<string, StickerPlacement[]>>({});
  const helmetKey = helmetStickerTarget(player.helmet);
  const targetKey = target === 'helmet' ? helmetKey : player.bike;
  const placements = drafts[targetKey] ?? player.stickers[targetKey] ?? emptyPlacements;
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const [size, setSize] = useState(DEFAULT_STICKER_SIZE);
  const [rotation, setRotation] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [assetRevision, setAssetRevision] = useState(0);
  const [hint, setHint] = useState(initialTarget === 'helmet' ? 'Helmschale antippen · Ziehen dreht die Ansicht' : 'Fläche antippen · Ziehen dreht die Ansicht');
  const state = useRef({ placements, drafts, target, targetKey, size, rotation, selected });
  state.current = { placements, drafts, target, targetKey, size, rotation, selected };
  const view = useRef<((angle: number) => void) | null>(null);
  const adjustPosition = useRef<((placement: StickerPlacement, action: 'center' | 'mirror') => StickerPlacement | undefined) | null>(null);
  const product = products.find(isSticker);
  // Inventory updates independently of the frozen preview: buying must not reset
  // the camera, renderer or unsaved sticker positions.
  const hasChanges = Object.keys(drafts).length > 0;
  const targetOwned = Object.keys(drafts).every((key) => ownsStickerTarget(account, key));
  const price = product ? digitalPrice(product) : 0;
  const total = stickerEditPrice(account, drafts, products);
  const purchaseRequired = total !== null && total > 0;
  const disabledReason = !hasChanges ? 'Sticker platzieren' : !targetOwned ? 'Motorrad zuerst freischalten'
    : total === null ? 'Positionen prüfen' : account.coins < total ? `Dir fehlen ${total - account.coins} Coins` : '';
  useEffect(() => {
    if (importedBikeReady(player.bike)) return;
    let cancelled = false;
    setReady(false);
    preloadImportedBike(player.bike).then(() => {
      if (!cancelled) setAssetRevision((revision) => revision + 1);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Motorradmodell konnte nicht geladen werden.');
    });
    return () => { cancelled = true; };
  }, [player.bike]);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !savePending.current) close.current(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el || !product || !importedBikeReady(player.bike)) return;
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
    const helmet = stickerHelmet(bike.rider), helmetParent = helmet?.parent;
    if (helmet) {
      scene.add(helmet);
      helmet.position.set(0, 1, 0);
      helmet.rotation.set(0, 0, 0);
    }
    adjustPosition.current = (placement, action) => {
      const helmetView = state.current.target === 'helmet';
      if (helmetView && !helmet) return undefined;
      return adjustStickerPlacement(helmetView ? helmet! : bike.body,
        helmetView ? helmetStickerSurfaces(helmet!) : stickerSurfaces(bike.body, bike.rider, player.paint),
        placement, action, helmetView);
    };
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0); controls.minDistance = 2.2; controls.maxDistance = 7;
    controls.minPolarAngle = 0.3; controls.maxPolarAngle = Math.PI * 0.65; controls.enablePan = false;
    controls.enableDamping = true;
    view.current = (angle) => {
      const showHelmet = state.current.target === 'helmet';
      bike.root.visible = !showHelmet;
      if (helmet) helmet.visible = showHelmet;
      controls.target.set(0, 1, 0);
      controls.minDistance = showHelmet ? 0.55 : 2.2;
      controls.maxDistance = showHelmet ? 2.5 : 7;
      const distance = showHelmet ? 1.1 : 4.8;
      camera.position.set(Math.sin(angle) * distance, showHelmet ? 1.18 : 2.35, Math.cos(angle) * distance);
      controls.update();
    };
    view.current(Math.PI / 2);
    const resize = () => { if (!el.clientWidth || !el.clientHeight) return; renderer.setSize(el.clientWidth, el.clientHeight, false); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const ray = new THREE.Raycaster();
    let down: [number, number] | undefined;
    const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const pointerUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 8 || savePending.current) { down = undefined; return; }
      down = undefined;
      const current = state.current;
      const helmetView = current.target === 'helmet';
      const surfaces = helmetView && helmet ? helmetStickerSurfaces(helmet) : stickerSurfaces(bike.body, bike.rider, player.paint);
      const rect = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      scene.updateMatrixWorld(true);
      const visible: THREE.Mesh[] = [];
      const collect = (object: THREE.Object3D) => {
        if (!object.visible || object === bike.rider || object.userData.bikeSticker) return;
        if (object instanceof THREE.Mesh) visible.push(object);
        object.children.forEach(collect);
      };
      if (helmetView && helmet) collect(helmet); else collect(bike.body);
      const hit = ray.intersectObjects(visible, false)[0];
      if (!hit?.face) { setHint(helmetView ? 'Bitte die feste Helmschale antippen.' : 'Bitte Verkleidung, Tank, Heckplastik oder Mudflap antippen.'); return; }
      const surface = [...surfaces].find(([, mesh]) => mesh === hit.object)?.[0];
      if (!surface || (helmetView && hit.face.materialIndex !== 0)) { setHint(helmetView ? 'Visier, Brille und Polster bleiben frei. Wähle eine Stelle auf der Helmschale.' : 'Wähle eine freie Stelle auf Verkleidung, Tank, Heckplastik oder Mudflap.'); return; }
      if (!current.selected && current.placements.length >= MAX_STICKERS) { setHint(`Maximal ${MAX_STICKERS} Sticker pro ${helmetView ? 'Helm' : 'Fahrzeug'}.`); return; }
      const id = current.selected ?? crypto.randomUUID();
      const placement: StickerPlacement = { id, productId: product.id, surface, point: hit.object.worldToLocal(hit.point.clone()).toArray(), normal: hit.face.normal.clone().normalize().toArray(), size: current.size, rotation: current.rotation };
      setDrafts((previous) => ({ ...previous, [current.targetKey]: current.selected ? current.placements.map((p) => p.id === id ? placement : p) : [...current.placements, placement] }));
      setSelected(id); setHint('Sticker gesetzt. Erneut tippen verschiebt ihn. Speichern übernimmt deine Vorschau.');
    };
    const lost = (event: Event) => { event.preventDefault(); setError('Grafik angehalten. Schließe und öffne die Werkstatt erneut.'); };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('webglcontextlost', lost);
    let raf = 0, lastBikePlacements: StickerPlacement[] | undefined, lastHelmetPlacements: StickerPlacement[] | undefined;
    const render = () => {
      raf = requestAnimationFrame(render);
      controls.enabled = !savePending.current; controls.update();
      const bikePlacements = state.current.drafts[player.bike] ?? player.stickers[player.bike] ?? emptyPlacements;
      const helmetPlacements = state.current.drafts[helmetKey] ?? player.stickers[helmetKey] ?? emptyPlacements;
      if (lastBikePlacements !== bikePlacements) {
        applyBikeStickers(bike.body, bike.rider, player.paint, bikePlacements);
        lastBikePlacements = bikePlacements;
      }
      if (helmet && lastHelmetPlacements !== helmetPlacements) {
        applyHelmetStickers(helmet, helmetPlacements);
        lastHelmetPlacements = helmetPlacements;
      }
      renderer.render(scene, camera); session.afterRender();
    };
    render(); setReady(true);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); view.current = null; adjustPosition.current = null;
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      if (helmet && helmetParent) helmetParent.add(helmet);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      bike.root.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
        if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m)); }
      });
      geometries.forEach((g) => g.dispose()); renderer.domElement.remove();
      session.release(() => materials.forEach((m) => m.dispose()));
    };
  }, [player, products, product, assetRevision, helmetKey]);
  useEffect(() => { view.current?.(Math.PI / 2); }, [target, ready]);
  function setPlacements(update: (previous: StickerPlacement[]) => StickerPlacement[]) {
    setDrafts((previous) => ({ ...previous, [targetKey]: update(previous[targetKey] ?? player.stickers[targetKey] ?? emptyPlacements) }));
  }
  function selectTarget(next: Target) {
    if (next === target || savePending.current) return;
    setTarget(next); setSelected(null); setSize(DEFAULT_STICKER_SIZE); setRotation(0);
    setHint(next === 'helmet' ? 'Tippe auf die Helmschale. Deine Motorrad-Sticker bleiben erhalten.' : 'Tippe auf Verkleidung, Tank, Heckplastik oder Mudflap. Deine Helm-Sticker bleiben erhalten.');
  }
  function change(value: number, field: 'size' | 'rotation') {
    if (field === 'size') setSize(value); else setRotation(value);
    if (selected) setPlacements((previous) => previous.map((p) => p.id === selected ? { ...p, [field]: value } : p));
  }
  function move(action: 'center' | 'mirror') {
    if (savePending.current) return;
    const original = state.current.placements.find(placement => placement.id === state.current.selected);
    if (!original) return;
    if (action === 'mirror' && state.current.placements.length >= MAX_STICKERS) {
      setHint(`Maximal ${MAX_STICKERS} Sticker pro ${target === 'helmet' ? 'Helm' : 'Fahrzeug'}.`); return;
    }
    const moved = adjustPosition.current?.(original, action);
    if (!moved) { setHint('Keine passende feste Fläche gefunden. Die Position bleibt erhalten.'); return; }
    if (action === 'mirror') {
      const copy = { ...moved, id: crypto.randomUUID() };
      setPlacements(previous => [...previous, copy]);
      setSelected(copy.id);
      setHint('Zweiter Sticker auf der anderen Seite platziert. Speichern übernimmt deine Vorschau.');
    } else {
      setPlacements(previous => previous.map(placement => placement.id === original.id ? moved : placement));
      setHint(`Sticker ${target === 'helmet' ? 'auf der Helmschale' : 'auf der Motorrad-Mittellinie'} zentriert. Speichern übernimmt die Position.`);
    }
  }
  async function save() {
    if (savePending.current || disabledReason || !ready || error) return;
    savePending.current = true; setSaving(true);
    const confirmedDrafts = structuredClone(state.current.drafts);
    try {
      const saved = await onSave(confirmedDrafts);
      if (!saved) setHint('Nicht gespeichert. Deine Vorschau bleibt erhalten; es wurde nichts abgezogen.');
    } catch { setHint('Speicherung nicht bestätigt. Bitte erneut versuchen.'); }
    finally { savePending.current = false; setSaving(false); }
  }
  return <main className="sticker-workshop" aria-label="Sticker-Werkstatt">
    <header><button className="button small" disabled={saving} onClick={onClose}>ZURÜCK</button><div><h1>STICKER PLATZIEREN</h1></div><span>{target === 'helmet' ? HELMETS.find((entry) => entry.id === player.helmet)?.name : BIKES.find((b) => b.id === player.bike)?.name}</span></header>
    <fieldset className="sticker-targets" aria-label="Sticker-Ziel"><button type="button" disabled={saving} aria-pressed={target === 'bike'} onClick={() => selectTarget('bike')}>MOTORRAD</button><button type="button" disabled={saving} aria-pressed={target === 'helmet'} onClick={() => selectTarget('helmet')}>HELM</button></fieldset>
    <div className="sticker-views" aria-label="Ansicht wählen">{[['LINKS', -Math.PI / 2], ['VORNE', Math.PI], ['RECHTS', Math.PI / 2], ['HINTEN', 0]].map(([label, angle]) => <button key={String(label)} disabled={!ready || saving} onClick={() => view.current?.(Number(angle))}>{label}</button>)}</div>
    <div className="sticker-stage" ref={host} data-testid="sticker-stage">
      {!ready && !error && <div className="scene-loading"><span className="spinner"/>SIMULATION WIRD GELADEN</div>}
      {error && <div className="graphics-error" role="alert"><p>{error}</p><button type="button" className="button small" onClick={() => window.location.reload()}>NEU LADEN</button></div>}
    </div>
    <section className="sticker-tools">
      <output className="sticker-hint">{hint}</output>
      <div className="sticker-items" aria-label="Platzierte Sticker">{placements.map((p, index) => <button key={p.id} disabled={saving} aria-pressed={selected === p.id} onClick={() => { setSelected(p.id); setSize(p.size); setRotation(p.rotation); setHint(`Sticker ${index + 1} ausgewählt. Tippen verschiebt ihn.`); }}>STICKER {index + 1}</button>)}
        {placements.length > 0 && <button disabled={saving || placements.length >= MAX_STICKERS} onClick={() => { setSelected(null); setSize(DEFAULT_STICKER_SIZE); setRotation(0); setHint('Tippe eine Fläche für den nächsten Sticker an.'); }}>+ WEITERER STICKER</button>}
        {selected && <button disabled={saving} aria-label="Ausgewählten Sticker entfernen" onClick={() => { setPlacements((p) => p.filter((s) => s.id !== selected)); setSelected(null); setSize(DEFAULT_STICKER_SIZE); setRotation(0); setHint('Sticker entfernt. Speichern übernimmt die Änderung.'); }}>ENTFERNEN</button>}
      </div>
      <section className="sticker-more sticker-settings" aria-label="Sticker-Werkzeuge"><h2>STICKER ANPASSEN</h2><div className="sticker-adjust"><label>GRÖSSE · {Math.round(size * 100)} CM <input disabled={saving} aria-label="Stickergröße" type="range" min="0.04" max={stickerMaxSize(targetKey)} step="0.01" value={size} onChange={(e) => change(Number(e.target.value), 'size')}/></label><label>DREHUNG <input disabled={saving} aria-label="Stickerdrehung" type="range" min={-Math.PI} max={Math.PI} step="0.05" value={rotation} onChange={(e) => change(Number(e.target.value), 'rotation')}/></label><div className="sticker-shortcuts" aria-label="Schnell einstellen">
        <button type="button" disabled={saving} onClick={() => change(Math.max(0.04, Math.round((size - 0.01) * 100) / 100), 'size')} aria-label="Sticker kleiner machen">− KLEINER</button>
        <button type="button" disabled={saving} onClick={() => change(Math.min(stickerMaxSize(targetKey), Math.round((size + 0.01) * 100) / 100), 'size')} aria-label="Sticker größer machen">+ GRÖSSER</button>
        <button type="button" disabled={saving} onClick={() => change(Math.max(-Math.PI, rotation - Math.PI / 4), 'rotation')} aria-label="Sticker 45 Grad nach links drehen">↶ 45°</button>
        <button type="button" disabled={saving} onClick={() => change(Math.min(Math.PI, rotation + Math.PI / 4), 'rotation')} aria-label="Sticker 45 Grad nach rechts drehen">↷ 45°</button>
        <button type="button" disabled={saving} onClick={() => change(0, 'rotation')} aria-label="Drehung zurücksetzen">0°</button>
        <button type="button" disabled={saving || !selected || !ready || Boolean(error)} onClick={() => move('center')} aria-label={target === 'helmet' ? 'Sticker auf Helmschale zentrieren' : 'Sticker auf gesamtem Motorrad zentrieren'}>ZENTRIEREN</button>
        <button type="button" disabled={saving || !selected || !ready || Boolean(error)} onClick={() => move('mirror')} aria-label="Stickerposition auf andere Seite spiegeln">POSITION SPIEGELN</button>
      </div></div></section>

      {product && <a className="sticker-original" href={product.url} target="_blank" rel="noreferrer"><img src={imagePath(product.localImage ?? product.image)} alt={product.title}/><span>Im Shop ansehen</span></a>}
    </section>
    <footer className="sticker-footer"><span>{price} Coins pro neuem Sticker<small>Gesamt: {total ?? '–'} Coins · Guthaben: {account.coins.toLocaleString('de-CH')} Coins</small></span><button className="button primary" disabled={saving || !!disabledReason || !ready || Boolean(error)} onClick={() => { void save(); }}>{saving ? 'Wird gespeichert …' : disabledReason || (purchaseRequired ? `Für ${total} Coins kaufen & speichern` : 'Speichern')}</button></footer>
  </main>;
}
