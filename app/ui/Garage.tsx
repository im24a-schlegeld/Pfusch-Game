import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ExternalLink, RotateCw } from 'lucide-react';
import type { Player, Product, ProductConfiguration, Slot } from '../domain/types';
import type { Services } from '../services';
import { confirmPlayerSave } from '../services/saveConfirmation';
import { BIKES, PAINTS, RIMS } from '../domain/config';
import { digitalLevel, digitalPrice, ownership } from '../domain/progression';
import { HELMETS, HELMET_COLORS, VISOR_COLORS } from '../domain/helmet';
import { isSticker } from '../domain/stickers';
import { equipmentSlot, equippable, imagePath, initialConfiguration, productColors, supportsHood } from '../domain/preview';
import { commitGarageEdit, commitStickerEdit, garageAppearance, garageEditChanged, garageOffer, type GarageEdit } from '../domain/garageEdit';
import { colorName, perceptualDistance } from '../domain/paletteView';
import { Coin, Preview } from './shared';
import SavedSetups from './SavedSetups';
import './garage-configurator.css';

const StickerWorkshop = lazy(() => import('./StickerWorkshop'));
type Part = 'model' | 'paint' | 'rims' | 'extras' | 'upper' | 'helmet' | 'head' | 'accessory';
type PaletteColor = { value: string; name: string; price?: number };
const bikeParts = [{ id: 'model', name: 'Modell' }, { id: 'paint', name: 'Lack' }, { id: 'rims', name: 'Felgen' }, { id: 'extras', name: 'Extras' }] as const;
const riderParts = [{ id: 'upper', name: 'Oberteil' }, { id: 'helmet', name: 'Kopf' }, { id: 'accessory', name: 'Accessoires' }] as const;
const partNames: Record<Part, string> = { model: 'Dein Motorrad', paint: 'Lack', rims: 'Felgen', extras: 'Motorrad-Extras', upper: 'Oberteil', helmet: 'Helm & Caps', head: 'Helm & Caps', accessory: 'Accessoires' };

/** Collapsing never hides the selected or equipped value. Expanding includes every original ID. */
function Palette({ title, colors, value, equipped, status, onChange }: {
  title: string; colors: readonly PaletteColor[]; value: string; equipped?: string;
  status: (color: PaletteColor) => string; onChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const color of colors) counts.set(color.name, (counts.get(color.name) ?? 0) + 1);
    return colors.map(color => ({ ...color, name: (counts.get(color.name) ?? 0) > 1
      ? `${color.name} · ${color.value.toUpperCase()}` : color.name }));
  }, [colors]);
  const compact = useMemo(() => {
    const remaining = [...options], chosen = remaining.splice(0, 1);
    while (chosen.length < 12 && remaining.length) {
      let best = 0, distance = -1;
      remaining.forEach((color, index) => {
        const nearest = Math.min(...chosen.map(other => perceptualDistance(color.value, other.value)));
        if (nearest > distance) { best = index; distance = nearest; }
      });
      chosen.push(...remaining.splice(best, 1));
    }
    for (const required of [value, equipped]) {
      const current = options.find(color => color.value === required);
      if (current && !chosen.some(color => color.value === required)) chosen.push(current);
    }
    return chosen;
  }, [options, value, equipped]);
  const selected = options.find(color => color.value === value);
  if (options.length === 1) return <div className="gc-single-color"><i style={{ background: options[0].value }} /><span>{title}: {options[0].name}</span></div>;
  return <fieldset className="gc-palette"><legend>{title}</legend>
    <div className="gc-color-summary" aria-live="polite"><strong>{selected?.name ?? value}</strong><span>{selected ? status(selected) : ''}</span></div>
    <div className="gc-swatches">{(expanded ? options : compact).map(color => <label key={color.value} className={value === color.value ? 'is-selected' : ''} title={`${color.name} · ${status(color)}`}>
      <input type="radio" name={`garage-${title}`} value={color.value} checked={value === color.value} onChange={() => onChange(color.value)} aria-label={`${title}: ${color.name} · ${status(color)}`} />
      <i style={{ background: color.value }} />{value === color.value && <Check size={16} aria-hidden="true" />}
    </label>)}</div>
    {options.length > 12 && <button className="gc-text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Weniger Farben' : `Weitere Farben (${options.length})`} <ChevronDown size={14} aria-hidden="true" /></button>}
  </fieldset>;
}

interface Props {
  player: Player; products: Product[]; update: (p: Player) => void; services: Services;
  notify: (s: string) => void; back: () => void; start: () => void; embedded?: boolean;
  onProgress?: () => void; onReady?: () => void; onLoadError?: (message: string) => void;
}
export default function Garage({ player, products, update, services, notify, start, embedded = false, onProgress, onReady, onLoadError }: Props) {
  const [part, setPart] = useState<Part>('model');
  const [previewEdit, setPreviewEdit] = useState<GarageEdit | null>(null);
  const [purchase, setPurchase] = useState<{ name: string; buying: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const [angle, setAngle] = useState(2.35);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [productView, setProductView] = useState<'front' | 'back'>('front');
  const [stickerBike, setStickerBike] = useState<Player | null>(null);
  const [stickerTarget, setStickerTarget] = useState<'bike' | 'helmet'>('bike');
  const pending = useRef(false);
  const account = useRef(player); account.current = player;
  const editRef = useRef(previewEdit); editRef.current = previewEdit;
  const appearance = useMemo(() => garageAppearance(player, previewEdit, products), [player, previewEdit, products]);
  const changed = garageEditChanged(player, previewEdit, products);
  const offer = previewEdit ? garageOffer(player, previewEdit, products) : null;
  const area = bikeParts.some(item => item.id === part) ? 'bike' : 'rider';
  const bike = BIKES.find(item => item.id === appearance.bike) ?? BIKES[0];
  const activeProducts = useMemo(() => products.filter(product => {
    const slot = equipmentSlot(product);
    if (part === 'upper') return slot === 'upper';
    if (part === 'head') return slot === 'head';
    if (part === 'accessory') return slot === 'accessory' || slot === 'lower' || slot === 'cape';
    if (part === 'extras') return slot === 'keychain' || slot === 'bike' || isSticker(product);
    return false;
  }), [products, part]);
  const selectedProduct = previewEdit?.kind === 'product' ? activeProducts.find(product => product.id === previewEdit.productId)
    : activeProducts.find(product => appearance.equipped[equipmentSlot(product)] === product.id);
  const configuration = selectedProduct ? previewEdit?.kind === 'product' && previewEdit.productId === selectedProduct.id
    ? previewEdit.configuration : initialConfiguration(player, selectedProduct) : null;
  const colors = useMemo(() => selectedProduct ? productColors(selectedProduct) : [], [selectedProduct]);
  const selectedColor = colors.find(color => color.variantIds.includes(configuration?.variantId ?? '')) ?? colors[0];
  const placingSticker = Boolean(selectedProduct && isSticker(selectedProduct));
  const mockup = productView === 'back' ? selectedColor?.back ?? selectedColor?.front : selectedColor?.front ?? selectedColor?.back;
  const focus = part === 'model' || part === 'paint' || part === 'rims' || part === 'upper' ? part
    : part === 'helmet' || part === 'head' ? 'head' : part === 'extras' && selectedProduct?.handle === 'schlusselanhanger' ? 'keychain'
      : part === 'extras' ? 'model'
        : selectedProduct && equipmentSlot(selectedProduct) === 'cape' ? 'cape' : 'accessory';
  const helmetEdit = previewEdit?.kind === 'helmet' ? previewEdit : { kind: 'helmet' as const, helmet: player.helmet, helmetColor: player.helmetColor, helmetVisor: player.helmetVisor };

  function selectPart(next: Part) {
    if (next === part) return;
    setNotice(changed ? 'Unbestätigte Vorschau verworfen. Dein ausgerüstetes Setup bleibt erhalten.' : '');
    setPreviewEdit(null); editRef.current = null; setPart(next); setProductView('front');
  }
  function setEdit(edit: GarageEdit) { editRef.current = edit; setPreviewEdit(edit); setNotice(''); }
  function selectProduct(product: Product) {
    if (previewEdit?.kind === 'product' && previewEdit.productId === product.id) return;
    setEdit({ kind: 'product', productId: product.id, configuration: initialConfiguration(player, product) });
    setProductView('front'); services.analytics.track('product_viewed', { id: product.id });
  }
  function editProduct(patch: Partial<ProductConfiguration>) {
    if (!selectedProduct || !configuration) return;
    const current = editRef.current;
    const base = current?.kind === 'product' && current.productId === selectedProduct.id ? current.configuration : configuration;
    setEdit({ kind: 'product', productId: selectedProduct.id, configuration: { ...base, ...patch } });
  }
  function editHelmet(patch: Partial<Pick<Player, 'helmet' | 'helmetColor' | 'helmetVisor'>>) {
    const current = editRef.current; setEdit({ ...(current?.kind === 'helmet' ? current : helmetEdit), ...patch });
  }
  function discard() { setPreviewEdit(null); editRef.current = null; setNotice('Vorschau verworfen.'); }
  async function confirmEdit() {
    if (pending.current) return;
    if (placingSticker) { openWorkshop(stickerTarget); return; }
    const snapshot = editRef.current, current = account.current;
    if (!snapshot || !garageEditChanged(current, snapshot, products)) { start(); return; }
    const confirmation = garageOffer(current, snapshot, products);
    if (confirmation.blocked) return;
    const next = commitGarageEdit(current, snapshot, products);
    if (!next) { setNotice('Auswahl konnte nicht übernommen werden. Es wurden keine Coins abgezogen.'); return; }
    pending.current = true; setPurchase({ name: confirmation.name, buying: !confirmation.owned && confirmation.price > 0 });
    try {
      // Ownership, exact variant, options and coins are committed in one synchronous update.
      update(next); account.current = next;
      if (editRef.current === snapshot) { editRef.current = null; setPreviewEdit(null); }
      await services.players.flush?.();
      const warning = services.players.warning;
      setNotice(warning ? `Lokal übernommen. ${warning}` : `${confirmation.name} ${confirmation.collectible ? 'zur Sammlung hinzugefügt' : 'ausgerüstet'}.`);
    } catch {
      // Retain the complete local transaction; a persistence retry cannot charge the owned item again.
      setNotice('Lokal übernommen. Die Kontospeicherung ist noch nicht bestätigt.');
    } finally { pending.current = false; setPurchase(null); }
  }
  function colorPalette(kind: 'paint' | 'rims') {
    const palette = (kind === 'paint' ? PAINTS : RIMS).map(color => ({ ...color, name: colorName(color.value) }));
    for (const id of [...player.ownedItems, `${kind}:${player[kind]}`]) if (id.startsWith(`${kind}:`)) {
      const value = id.slice(kind.length + 1);
      if (/^#[\da-f]{6}$/i.test(value) && !palette.some(color => color.value === value)) palette.push({ value, name: colorName(value), price: 0 });
    }
    return <Palette title={kind === 'paint' ? 'Lackfarbe' : 'Felgenfarbe'} colors={palette} value={appearance[kind]} equipped={player[kind]}
      status={color => player[kind] === color.value ? 'Ausgerüstet' : player.ownedItems.includes(`${kind}:${color.value}`) ? 'In deinem Besitz' : `${color.price} Coins`}
      onChange={value => setEdit({ kind, value })} />;
  }
  const productStatus = (product: Product) => {
    const state = ownership(player, product);
    return state === 'EQUIPPED' ? 'Ausgerüstet' : state === 'OWNED_IRL' ? 'Dein PFUSCH-Artikel' : state === 'UNLOCKED_DIGITAL' ? 'In deinem Besitz' : `${digitalPrice(product)} Coins${digitalLevel(product) > 1 ? ` · Level ${digitalLevel(product)}` : ''}`;
  };
  const removeSlot = (slot: Slot) => setEdit({ kind: 'remove', slot });
  const openWorkshop = (target: 'bike' | 'helmet') => { setStickerTarget(target); setStickerBike(player); };
  const buttonText = purchase ? purchase.buying ? 'Wird gekauft …' : 'Wird gespeichert …' : placingSticker ? 'Platzieren' : !changed ? 'Fahrt starten'
    : offer?.blocked ?? (offer?.owned || offer?.price === 0 ? 'Ausrüsten' : `Für ${offer?.price ?? 0} Coins ${offer?.collectible ? 'sammeln' : 'kaufen & ausrüsten'}`);

  if (stickerBike) return <Suspense fallback={<main className="sticker-loading"><span className="spinner" /><output>STICKER-WERKSTATT WIRD GELADEN</output><button className="button" onClick={() => setStickerBike(null)}>ABBRECHEN</button></main>}>
    <StickerWorkshop player={stickerBike} account={player} products={products} initialTarget={stickerTarget} onClose={() => setStickerBike(null)} onSave={async drafts => {
      if (pending.current) return false;
      const next = commitStickerEdit(account.current, drafts, products);
      if (!next) { notify('Positionen konnten nicht gespeichert werden. Prüfe Coins und Fahrzeugbesitz. Es wurde nichts abgezogen.'); return false; }
      pending.current = true;
      try {
        update(next); account.current = next;
        const result = await confirmPlayerSave(services.players);
        if (!result.confirmed) {
          // Keep the frozen preview and all surface drafts. Ownership is already
          // updated atomically, so retrying Save cannot buy the sticker twice.
          notify(`In dieser Sitzung übernommen. Speicherung noch nicht bestätigt. ${result.detail}`);
          return true;
        }
        setStickerBike(null); setPreviewEdit(null); editRef.current = null; notify('Sticker platziert und gespeichert.');
        return true;
      } finally { pending.current = false; }
    }} />
  </Suspense>;

  return <main className="garage-page garage-configurator"><div className="gc-layout">
    <section className="gc-preview" aria-label="Motorrad- und Fahrervorschau">
      <div className="gc-preview-heading"><span className={`gc-state${changed ? ' is-preview' : ''}`}>{changed ? 'VORSCHAU' : 'AKTUELLES SETUP'}</span>
        <div className="gc-balance"><Coin value={player.coins} />{embedded && <button onClick={onProgress} aria-label={`Fortschritt, Stufe ${player.level}`}>ST. {String(player.level).padStart(2, '0')}</button>}</div>
        {changed && <button className="gc-text-button" onClick={discard}>Verwerfen</button>}
      </div>
      <div className="gc-model" data-testid="garage-model" data-bike={appearance.bike} data-paint={appearance.paint} data-rims={appearance.rims}
        data-variant={configuration?.variantId ?? ''} data-product={selectedProduct?.id ?? appearance.equipped.upper ?? ''}
        data-number={appearance.customizations[appearance.equipped.upper ?? '']?.customNumber ?? ''}
        data-hood={appearance.customizations[appearance.equipped.upper ?? '']?.hoodEnabled === true}
        data-helmet={appearance.helmet} data-helmet-color={appearance.helmetColor} data-helmet-visor={appearance.helmetVisor}>
        <Preview player={appearance} products={products} mode="garage" onReady={onReady} onLoadError={onLoadError}
          inspectionFocus={focus} inspectionAngle={angle} inspectionRevision={inspectionRevision} />
      </div>
      <div className="gc-preview-footer"><h2>{bike.name}</h2><p>{products.find(product => product.id === appearance.equipped.upper)?.title ?? 'Standard-Outfit'}</p></div>
      <div className="gc-angles" aria-label="Kameraansicht"><RotateCw size={14} aria-hidden="true" />
        {[{ name: 'Vorne ¾', value: 2.35 }, { name: 'Seite', value: 1.57 }, { name: 'Hinten ¾', value: .55 }].map(view => <button key={view.name} onClick={() => { setAngle(view.value); setInspectionRevision(revision => revision + 1); }}>{view.name}</button>)}
        <span>Ziehen · Zoomen</span>
      </div>
    </section>
    <section className="gc-controls" aria-label="Garage konfigurieren">
      <nav className="gc-areas" aria-label="Garage-Bereiche"><button aria-pressed={area === 'bike'} onClick={() => { if (area !== 'bike') selectPart('model'); }}>Motorrad</button><button aria-pressed={area === 'rider'} onClick={() => { if (area !== 'rider') selectPart('upper'); }}>Fahrer</button></nav>
      <nav className="gc-parts" aria-label="Ausrüstungsteil">{(area === 'bike' ? bikeParts : riderParts).map(item => <button key={item.id} aria-pressed={part === item.id || (part === 'head' && item.id === 'helmet')} onClick={() => selectPart(item.id)}>{item.name}</button>)}</nav>
      <div className="gc-panel"><div className="gc-panel-title"><h2>{partNames[part]}</h2><span>KOSTENLOS AUSPROBIEREN</span></div>
        {part === 'model' && <div className="gc-bikes" aria-label="Motorradmodell">{BIKES.map((item, index) => {
          const owned = player.ownedItems.includes(`bike:${item.id}`);
          return <button key={item.id} className="gc-bike" aria-pressed={appearance.bike === item.id} onClick={() => setEdit({ kind: 'model', value: item.id })}>
            <span className="gc-bike-index">0{index + 1}</span><span><strong>{item.name}</strong><small>{item.tag}</small><span>{player.bike === item.id ? 'Ausgerüstet' : owned ? 'In deinem Besitz' : `Level ${item.level} · ${item.price} Coins`}</span></span>
            {appearance.bike === item.id ? <Check size={18} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
          </button>;
        })}</div>}
        {(part === 'paint' || part === 'rims') && colorPalette(part)}
        {(part === 'helmet' || part === 'head') && <div className="gc-toggle" aria-label="Kopfausrüstung"><button aria-pressed={part === 'helmet'} onClick={() => selectPart('helmet')}>Helm</button><button aria-pressed={part === 'head'} onClick={() => selectPart('head')}>Caps am Hüftclip</button></div>}
        {part === 'helmet' && <div className="gc-helmet-options">
          <fieldset className="gc-field"><legend>Helmtyp</legend><div className="gc-toggle">{HELMETS.map(helmet => <button key={helmet.id} aria-pressed={appearance.helmet === helmet.id} onClick={() => editHelmet({ helmet: helmet.id })}>{helmet.name}</button>)}</div></fieldset>
          <Palette title="Helmfarbe" colors={HELMET_COLORS.map(color => ({ ...color, name: colorName(color.value) }))} value={appearance.helmetColor} equipped={player.helmetColor} status={() => 'Kostenlos'} onChange={helmetColor => editHelmet({ helmetColor })} />
          <Palette title="Visier / Brillenglas" colors={VISOR_COLORS} value={appearance.helmetVisor} equipped={player.helmetVisor} status={() => 'Kostenlos'} onChange={helmetVisor => editHelmet({ helmetVisor })} />
          {products.some(isSticker) && <button className="gc-secondary" onClick={() => { selectPart('extras'); const sticker = products.find(isSticker)!; setEdit({ kind: 'product', productId: sticker.id, configuration: initialConfiguration(player, sticker) }); setStickerTarget('helmet'); }}>Helmsticker auswählen</button>}
        </div>}
        {part === 'head' && <p className="gc-help">Caps hängen am Hüftclip. Dein Fahrhelm bleibt auf.</p>}
        {part === 'accessory' && <p className="gc-help">Tasche, Cape und Cap lassen sich gemeinsam tragen. Alles kostenlos anprobieren; erst Ausrüsten speichert deine Auswahl.</p>}
        {part === 'extras' && <p className="gc-help">Passend für {bike.name}: Sticker auf gültigen Flächen, Schlüsselanhänger am Befestigungspunkt.</p>}
        {['upper', 'head', 'accessory', 'extras'].includes(part) && <>
          {products.length === 0 && <output className="gc-help">Produkte werden geladen …</output>}
          <div className="gc-products" aria-label="Artikelauswahl">{activeProducts.map(product => {
            const active = selectedProduct?.id === product.id;
            const config = active && configuration ? configuration : initialConfiguration(player, product);
            const color = productColors(product).find(item => item.variantIds.includes(config.variantId));
            return <button key={product.id} className="gc-product" data-testid="product-card" aria-label={`${product.title} · ${productStatus(product)}`} aria-pressed={active} onClick={() => selectProduct(product)}>
              <span className="gc-product-image"><img src={imagePath(color?.front?.localImage ?? product.localImage ?? product.image)} alt={product.title} loading="lazy" />{active && <Check size={16} aria-hidden="true" />}</span><strong>{product.title}</strong><span>{productStatus(product)}</span>
            </button>;
          })}</div>
          <div className="gc-remove-options">{([...new Set(activeProducts.filter(equippable).map(equipmentSlot))]).map(slot => player.equipped[slot] && <button key={slot} className="gc-text-button" onClick={() => removeSlot(slot)}>{slot === 'upper' ? 'Standard-Outfit' : `Ohne ${slot === 'head' ? 'Cap' : slot === 'cape' ? 'Cape' : slot === 'keychain' ? 'Schlüsselanhänger' : 'Accessoire'}`}</button>)}</div>
        </>}
        {selectedProduct && configuration && <section className="gc-product-options" aria-label={`${selectedProduct.title} konfigurieren`}>
          <div className="gc-selected-heading"><h3>{selectedProduct.title}</h3><span>{productStatus(selectedProduct)}</span></div>
          {colors.length > 0 && <Palette key={selectedProduct.id} title="Artikelfarbe" colors={colors.map(color => ({ name: color.label, value: color.baseColor }))}
            value={selectedColor?.baseColor ?? selectedProduct.baseColor} status={() => productStatus(selectedProduct)} onChange={value => { const color = colors.find(item => item.baseColor === value); if (color?.variantIds[0]) editProduct({ variantId: color.variantIds[0] }); }} />}
          {selectedProduct.preview?.numberCustomization && <label className="gc-number">Deine Racing-Nummer<input aria-label={`${selectedProduct.title} Nummer`} inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} placeholder="23" value={configuration.customNumber ?? ''} onChange={event => editProduct({ customNumber: event.target.value.replace(/\D/g, '').slice(0, 2) })} /><small>1–2 Ziffern · Pflichtfeld</small></label>}
          {supportsHood(selectedProduct) && <fieldset className="gc-field"><legend>Kapuze</legend><div className="gc-toggle">{[false, true].map(hoodEnabled => <button key={String(hoodEnabled)} aria-pressed={(configuration.hoodEnabled === true) === hoodEnabled} onClick={() => editProduct({ hoodEnabled })}>{hoodEnabled ? 'Mit Kapuze' : 'Ohne Kapuze'}</button>)}</div></fieldset>}
          {selectedColor?.front && selectedColor?.back && <button className="gc-text-button" onClick={() => { const next = productView === 'front' ? 'back' : 'front'; setProductView(next); setAngle(next === 'front' ? Math.PI : 0); setInspectionRevision(revision => revision + 1); }}>{productView === 'front' ? 'Rückseite zeigen' : 'Vorderseite zeigen'}</button>}
          {isSticker(selectedProduct) && <div className="gc-placement"><p>Wo soll dein Sticker hin?</p><div className="gc-toggle" aria-label="Sticker-Ziel"><button aria-pressed={stickerTarget === 'bike'} onClick={() => setStickerTarget('bike')}>Motorrad</button><button aria-pressed={stickerTarget === 'helmet'} onClick={() => setStickerTarget('helmet')}>Helm</button></div><p>Mit „Platzieren“ kostenlos ausprobieren. Gekauft wird erst beim Speichern.</p></div>}
          <details className="gc-details"><summary>Artikeldetails & Originalbild</summary><img src={imagePath(mockup?.localImage ?? selectedProduct.localImage ?? selectedProduct.image)} alt={selectedProduct.title} loading="lazy" /><p>{selectedProduct.description}</p><p>Digitaler Spielartikel · kein physischer Versand</p><a href={selectedProduct.url} target="_blank" rel="noreferrer">Original im PFUSCH-Shop <ExternalLink size={14} aria-hidden="true" /></a></details>
        </section>}
        <div className="gc-utilities"><a href="https://pfusch-clothing.ch" target="_blank" rel="noreferrer">PFUSCH-Shop <ExternalLink size={13} aria-hidden="true" /></a></div>
        <SavedSetups player={player} products={products} services={services} update={next => { account.current = next; update(next); }} notify={notify} previewing={changed || !!purchase} onEquip={discard} />
        <output className="gc-notice">{notice || 'Nur Ausrüsten übernimmt deine Vorschau.'}</output>
      </div>
    </section>
    <div className="gc-action" aria-label="Auswahl übernehmen"><div className="gc-action-summary" aria-live="polite"><strong>{placingSticker ? `Sticker auf ${stickerTarget === 'helmet' ? 'Helm' : bike.name}` : changed ? offer?.name : 'Dein Setup ist bereit'}</strong><span>{purchase ? `${purchase.name} wird gespeichert` : placingSticker ? 'Kostenlose Vorschau' : changed ? offer?.owned ? 'In deinem Besitz · kostenlose Änderung' : `${offer?.price ?? 0} Coins · digitaler Spielartikel` : 'Bestätigte Ausrüstung'}</span></div>
      <button className="gc-primary" disabled={!!purchase || (!placingSticker && changed && !!offer?.blocked)} onClick={() => { void confirmEdit(); }}>{buttonText}{!purchase && (placingSticker || !(changed && offer?.blocked)) && <ArrowRight size={18} aria-hidden="true" />}</button>
      {changed && <button className="gc-action-discard" onClick={discard}>Verwerfen</button>}
    </div>
  </div></main>;
}
