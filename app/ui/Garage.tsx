import { lazy, Suspense, useMemo, useState } from 'react';
import { ArrowRight, RotateCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Player, Product, ProductConfiguration } from '../domain/types';
import type { Services } from '../services';
import { BIKES, PAINTS, RIMS } from '../domain/config';
import { digitalPrice, ownership, unlock } from '../domain/progression';
import { HELMETS, HELMET_COLORS, VISOR_COLORS, equipHelmet } from '../domain/helmet';
import { isSticker, saveStickerTargets } from '../domain/stickers';
import {
  equipConfiguration,
  equipmentSlot,
  equippable,
  imagePath,
  previewLoadout,
  initialConfiguration,
  productColors,
  supportsHood,
} from '../domain/preview';
import {
  Coin,
  Preview,
  XpBar,
} from './shared';
import { ProgressContent } from './Screens';
import ColorSection from './ColorSection';
import { colorName, visiblePalette } from '../domain/paletteView';
const StickerWorkshop = lazy(() => import('./StickerWorkshop'));

const isMotorcycleProduct = (p: Product) =>
  p.category === 'bike' || p.handle === 'schlusselanhanger' || isSticker(p);

interface Props {
  player: Player;
  products: Product[];
  update: (p: Player) => void;
  services: Services;
  notify: (s: string) => void;
  back: () => void;
  start: () => void;
  embedded?: boolean;
  onProgress?: () => void;
  onReady?: () => void;
  onLoadError?: (message: string) => void;
}
export default function Garage({
  player,
  products,
  update,
  services,
  notify,
  start,
  embedded = false,
  onProgress,
  onReady,
  onLoadError,
}: Props) {
  const [tab, setTab] = useState('rider');
  const [filter, setFilter] = useState('all');
  const [productViews, setProductViews] = useState<
    Record<string, 'front' | 'back'>
  >({});
  const [draft, setDraft] = useState<Player | null>(null);
  const [stickerBike, setStickerBike] = useState<Player | null>(null);
  const [stickerTarget, setStickerTarget] = useState<'bike' | 'helmet'>('bike');
  const [selected, setSelected] = useState<Product | null>(null);
  const [configuration, setConfiguration] =
    useState<ProductConfiguration | null>(null);
  const [angle, setAngle] = useState(2.35);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [recentProductIds, setRecentProductIds] = useState<string[]>([]);
  const appearance = draft ?? player;
  const bike = BIKES.find((b) => b.id === appearance.bike) ?? BIKES[0];
  const owned = (id: string) => player.ownedItems.includes(id);
  const rememberProduct = (id: string) =>
    setRecentProductIds((ids) => [id, ...ids.filter((value) => value !== id)].slice(0, 3));
  function unlockProduct(p: Product, config: ProductConfiguration) {
    rememberProduct(p.id);
    const unlocked = unlock(player, p.id, digitalPrice(p));
    if (!unlocked) {
      notify('Du brauchst mehr Coins.');
      return;
    }
    if (supportsHood(p)) {
      update(unlocked);
      setDraft(previewLoadout(unlocked, p, config));
      notify(
        `${p.title} freigeschaltet. Mit Ausrüsten wird deine Auswahl gespeichert.`,
      );
      return;
    }
    if (equippable(p)) {
      const equipped = equipConfiguration(unlocked, p, config);
      if (equipped) {
        update(equipped);
        setDraft(null);
        setSelected(null);
        setConfiguration(null);
        services.analytics.track('product_equipped', { id: p.id });
        notify(`${p.title} freigeschaltet und direkt ausgerüstet.`);
        return;
      }
    }
    update(unlocked);
    setDraft(null);
    setSelected(null);
    setConfiguration(null);
    notify(`${p.title} freigeschaltet.`);
  }
  function equipProduct(p: Product, config: ProductConfiguration) {
    rememberProduct(p.id);
    const next = equipConfiguration(player, p, config);
    if (!next) {
      notify('Schalte den Artikel frei, bevor du ihn ausrüstest.');
      return;
    }
    update(next);
    setDraft(null);
    services.analytics.track('product_equipped', { id: p.id });
    notify(`${p.title} ausgerüstet und gespeichert.`);
  }
  function unequipProduct(p: Product) {
    rememberProduct(p.id);
    const slot = equipmentSlot(p);
    if (player.equipped[slot] !== p.id) return;
    const equipped = { ...player.equipped };
    delete equipped[slot];
    update({ ...player, equipped });
    if (selected?.id === p.id) {
      setDraft(null);
      setSelected(null);
      setConfiguration(null);
    }
    notify(`${p.title} abgelegt.`);
  }
  function previewBike(
    values: Partial<Pick<Player, 'bike' | 'paint' | 'rims'>>,
  ) {
    setDraft({ ...appearance, ...values });
  }
  function buyBikeOption(id: string, price: number, name: string, level = 1) {
    const next = unlock(player, id, price, level);
    if (!next) {
      notify(player.level < level ? `Ab Level ${level} erhältlich.` : 'Du brauchst mehr Coins.');
      return;
    }
    if (next === player) return;
    update(next);
    // Buying changes ownership only. Keep the free try-on setup until Equip.
    setDraft((current) => current ? { ...current, coins: next.coins, ownedItems: next.ownedItems } : null);
    notify(`${name} gekauft. Mit Ausrüsten wird deine Auswahl gespeichert.`);
  }
  function equipBikeOption(values: Partial<Pick<Player, 'bike' | 'paint' | 'rims'>>) {
    if (Object.entries(values).some(([kind, value]) => !owned(`${kind}:${value}`))) return;
    if (values.bike && player.level < (BIKES.find((entry) => entry.id === values.bike)?.level ?? Infinity)) return;
    update({ ...player, ...values });
    setDraft(null);
    notify('Ausgerüstet und gespeichert.');
  }
  function colorOptions(kind: 'paint' | 'rims') {
    const palette = kind === 'paint' ? PAINTS : RIMS;
    const title = kind === 'paint' ? 'Lackfarbe' : 'Felgenfarbe';
    const colors = visiblePalette(palette, appearance[kind]);
    for (const color of palette) {
      if (owned(`${kind}:${color.value}`) && !colors.some((entry) => entry.value === color.value))
        colors.push({ ...color, name: colorName(color.value) });
    }
    return <ColorSection title={title} value={appearance[kind]}>
      <div className="finish-options" aria-label={title}>
        {colors.map((color) => {
          const isOwned = owned(`${kind}:${color.value}`);
          const isEquipped = player[kind] === color.value;
          return <article className={`finish-option ${appearance[kind] === color.value ? 'selected' : ''}`} key={color.value}>
            <div className="finish-preview" aria-label={`${color.name} ${kind}`}>
              <i style={{ background: color.value }} />
              <span><b>{color.name}</b></span>
            </div>
            <div className="finish-option-actions">
              <button className="button small" aria-label={`Ansehen ${title} ${color.name}`}
                aria-pressed={appearance[kind] === color.value}
                onClick={() => previewBike({ [kind]: color.value })}>
                ANSEHEN
              </button>
              <button className="button small" aria-label={`${isOwned ? 'Ausrüsten' : 'Kaufen'} ${title} ${color.name}`}
                disabled={isOwned ? isEquipped : player.coins < color.price}
                onClick={() => isOwned
                  ? equipBikeOption({ [kind]: color.value })
                  : buyBikeOption(`${kind}:${color.value}`, color.price, color.name)}>
                {isOwned ? (isEquipped ? 'AUSGERÜSTET' : 'AUSRÜSTEN') : <>KAUFEN <Coin value={color.price} /></>}
              </button>
            </div>
          </article>;
        })}
      </div>
    </ColorSection>;
  }
  function equipHelmetNow(
    values: Partial<Pick<Player, 'helmet' | 'helmetColor' | 'helmetVisor'>>,
  ) {
    const next = equipHelmet(player, {
      helmet: values.helmet ?? player.helmet,
      helmetColor: values.helmetColor ?? player.helmetColor,
      helmetVisor: values.helmetVisor ?? player.helmetVisor,
    });
    if (!next) return;
    update(next);
    setDraft(null);
    notify('Helm ausgerüstet.');
  }
  const visible = useMemo(
    () => {
      const filtered = products.filter((p) => {
        const motorcycleItem = isMotorcycleProduct(p);
        if (tab === 'bike') {
          return motorcycleItem && (filter === 'all' || filter === 'motorcycle');
        }
        return !motorcycleItem && (filter === 'all' || p.category === filter);
      });
      return [...filtered].sort(
        (a, b) =>
          (recentProductIds.indexOf(a.id) < 0 ? 99 : recentProductIds.indexOf(a.id)) -
          (recentProductIds.indexOf(b.id) < 0 ? 99 : recentProductIds.indexOf(b.id)),
      );
    },
    [products, tab, filter, recentProductIds],
  );
  const openProduct = (p: Product) => {
    rememberProduct(p.id);
    const config = initialConfiguration(appearance, p);
    setConfiguration(config);
    setDraft(previewLoadout(appearance, p, config));
    setSelected(p);
    services.analytics.track('product_viewed', { id: p.id });
  };
  const grid = (
    <>
      <p className="digital-only-note">
        Käufe in der Garage sind nur digitale Spielgegenstände. Es wird nichts physisch versendet.
      </p>
      <div className="category-filter" aria-label="Produktkategorien">
        {(tab === 'bike'
          ? ['all', 'motorcycle']
          : ['all', 'upper', 'head', 'accessory', 'collectible']
        ).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            className={filter === f ? 'active' : ''}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? 'ALLE'
              : f === 'upper'
                ? 'OBERTEILE'
                : f === 'head'
                  ? 'KOPFBEDECKUNG'
                  : f === 'accessory'
                    ? 'ACCESSOIRES'
                    : f === 'collectible'
                      ? 'SAMMELSTÜCKE'
                      : 'MOTORRAD'}
          </button>
        ))}
      </div>
      <div className="product-grid compact-product-grid">
        {products.length === 0 ? (
          <output className="product-loading">
            <span className="spinner" />
            <span>PRODUKTE WERDEN GELADEN</span>
          </output>
        ) : visible.map((p) => {
          const state = ownership(player, p);
          const colors = productColors(p);
          const baseConfig = initialConfiguration(player, p);
          const variantId = appearance.variants[p.id] ?? baseConfig.variantId;
          const config: ProductConfiguration = {
            ...baseConfig,
            variantId,
            ...(supportsHood(p)
              ? {
                  hoodEnabled:
                    appearance.customizations[p.id]?.hoodEnabled === true,
                }
              : {}),
            ...(p.preview?.numberCustomization
              ? {
                  customNumber:
                    appearance.customizations[p.id]?.customNumber ??
                    baseConfig.customNumber ??
                    '',
                }
              : {}),
          };
          const selectedColor =
            colors.find((c) => c.variantIds.includes(config.variantId)) ??
            colors[0];
          const productView = productViews[p.id] ?? 'front';
          const selectedMockup =
            productView === 'back'
              ? selectedColor?.back ?? selectedColor?.front
              : selectedColor?.front ?? selectedColor?.back;
          const mockupSource =
            selectedMockup?.localImage ?? p.localImage ?? p.image;
          const hasFrontAndBack = Boolean(
            selectedColor?.front && selectedColor?.back,
          );
          const isOwned = state !== 'LOCKED';
          const isEquipped = state === 'EQUIPPED';
          const canWear = equippable(p);
          return (
            <article
              key={p.id}
              className="product-card compact-product-card"
              data-testid="product-card"
            >
              <div className="product-image">
              <button
                className="product-open product-main-action"
                aria-label={`${isSticker(p) ? 'Stickerbild' : 'Ansehen'} ${p.title}`}
                onClick={() => {
                  if (!isSticker(p)) openProduct(p);
                  setAngle(productView === 'front' ? Math.PI : 0);
                  setInspectionRevision((r) => r + 1);
                }}
              >
                <span className="image-loader" aria-hidden="true">
                  <i />
                </span>
                <img
                  className="product-mockup-image"
                  src={imagePath(mockupSource)}
                  alt={p.title}
                  loading="lazy"
                  decoding="async"
                  width="360"
                  height="360"
                  onLoad={(e) =>
                    e.currentTarget
                      .closest('.product-image')
                      ?.classList.add('image-loaded')
                  }
                  onError={(e) =>
                    e.currentTarget
                      .closest('.product-image')
                      ?.classList.add('image-loaded')
                  }
                />
              </button>
                {hasFrontAndBack && (
                  <>
                    <button
                      className="mockup-arrow mockup-arrow-left"
                      aria-label={`${p.title} vorherige Ansicht`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextView =
                          productView === 'front' ? 'back' : 'front';
                        setProductViews((views) => ({
                          ...views,
                          [p.id]: nextView,
                        }));
                        if (canWear) {
                          setDraft(previewLoadout(player, p, config));
                          setSelected(p);
                          setConfiguration(config);
                          services.analytics.track('product_viewed', {
                            id: p.id,
                          });
                        }
                        setAngle(nextView === 'front' ? Math.PI : 0);
                        setInspectionRevision((r) => r + 1);
                      }}
                    >
                      ‹
                    </button>
                    <button
                      className="mockup-arrow mockup-arrow-right"
                      aria-label={`${p.title} nächste Ansicht`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextView =
                          productView === 'front' ? 'back' : 'front';
                        setProductViews((views) => ({
                          ...views,
                          [p.id]: nextView,
                        }));
                        if (canWear) {
                          setDraft(previewLoadout(player, p, config));
                          setSelected(p);
                          setConfiguration(config);
                          services.analytics.track('product_viewed', {
                            id: p.id,
                          });
                        }
                        setAngle(nextView === 'front' ? Math.PI : 0);
                        setInspectionRevision((r) => r + 1);
                      }}
                    >
                      ›
                    </button>
                  </>
                )}
                <span className="ownership">
                  {isEquipped
                    ? 'AUSGERÜSTET'
                    : isOwned && canWear
                      ? 'AUSRÜSTEN'
                      : isOwned
                        ? 'GEKAUFT'
                        : 'SPIELITEM'}
                </span>
                {recentProductIds.includes(p.id) && (
                  <span className="recent-product-badge">ZULETZT</span>
                )}
              </div>
              <div className="product-body compact-product-body">
                <h3>{p.title}</h3>
                <p className="compact-product-description">{p.description}</p>
                {colors.length > 0 && (
                  <div className="inline-color-swatches" aria-label={`${p.title} Farben`}>
                    {colors.map((c) => {
                      const colorSelected = c.variantIds.includes(config.variantId);
                      return (
                        <button
                          key={c.id}
                          className={colorSelected ? 'selected' : ''}
                          aria-label={`Farbe ${c.label}`}
                          aria-pressed={colorSelected}
                          title={c.label}
                          onClick={() => {
                            const nextConfig: ProductConfiguration = {
                              ...config,
                              variantId: c.variantIds[0] ?? config.variantId,
                            };
                            setProductViews((views) => ({
                              ...views,
                              [p.id]: 'front',
                            }));
                            if (isOwned && canWear && !supportsHood(p)) {
                              equipProduct(p, nextConfig);
                            } else if (canWear) {
                              setDraft(previewLoadout(player, p, nextConfig));
                              setSelected(p);
                              setConfiguration(nextConfig);
                              services.analytics.track('product_viewed', {
                                id: p.id,
                              });
                            }
                            setAngle(Math.PI);
                            setInspectionRevision((r) => r + 1);
                          }}
                        >
                          <i style={{ background: c.baseColor }} />
                        </button>
                      );
                    })}
                  </div>
                )}
                {p.preview?.numberCustomization && (
                  <div className="inline-number-picker">
                    <span>NUMMER</span>
                    <input
                      aria-label={`${p.title} Nummer`}
                      inputMode="numeric"
                      pattern="[0-9]{1,2}"
                      maxLength={2}
                      placeholder="23"
                      value={config.customNumber ?? ''}
                      onChange={(e) => {
                        const customNumber = e.target.value
                          .replace(/\D/g, '')
                          .slice(0, 2);
                        const nextConfig: ProductConfiguration = {
                          ...config,
                          customNumber,
                        };
                        if (
                          isOwned &&
                          canWear &&
                          /^\d{1,2}$/.test(customNumber)
                        ) {
                          equipProduct(p, nextConfig);
                        } else if (canWear) {
                          setDraft(previewLoadout(player, p, nextConfig));
                          services.analytics.track('product_viewed', { id: p.id });
                        }
                      }}
                    />
                    <small>1–2 ZIFFERN</small>
                  </div>
                )}
                {supportsHood(p) && (
                  <fieldset
                    className="inline-hood-picker hood-options"
                    aria-label="Windbreaker Kapuze · kostenlose Vorschau"
                  >
                    {[false, true].map((hoodEnabled) => (
                      <button
                        key={String(hoodEnabled)}
                        aria-pressed={(config.hoodEnabled === true) === hoodEnabled}
                        onClick={() => {
                          const nextConfig = { ...config, hoodEnabled };
                          setConfiguration(nextConfig);
                          setSelected(p);
                          setDraft(previewLoadout(appearance, p, nextConfig));
                        }}
                      >
                        {hoodEnabled ? 'Mit Kapuze' : 'Ohne Kapuze'}
                      </button>
                    ))}
                  </fieldset>
                )}
                <div
                  className={`product-actions${isSticker(p) ? ' sticker-actions' : ''}`}
                >
                  <button
                    className="button small primary compact-buy-button"
                    disabled={
                      (state === 'LOCKED' && player.coins < digitalPrice(p)) ||
                      (p.preview?.numberCustomization &&
                        !/^\d{1,2}$/.test(config.customNumber ?? ''))
                    }
                    onClick={() => {
                      if (state === 'LOCKED') {
                        unlockProduct(p, config);
                      } else if (canWear) {
                        if (isEquipped) unequipProduct(p);
                        else equipProduct(p, config);
                      }
                    }}
                  >
                    {state === 'LOCKED'
                      ? `KAUFEN · ${digitalPrice(p)} COINS`
                      : canWear
                        ? isEquipped
                          ? 'ABLEGEN'
                          : 'AUSRÜSTEN'
                        : 'GEKAUFT'}
                  </button>
                  {!isSticker(p) && (
                    <button
                      className="button small"
                      onClick={() => {
                        openProduct(p);
                        setAngle(productView === 'front' ? Math.PI : 0);
                        setInspectionRevision((r) => r + 1);
                      }}
                    >
                      ANSEHEN
                    </button>
                  )}
                </div>
                {isSticker(p) && (
                  <button
                    className="button small"
                    onClick={() => { setStickerTarget('bike'); setStickerBike(appearance); }}
                  >
                    AUF FAHRZEUG / HELM PLATZIEREN
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
  if (stickerBike) return <Suspense fallback={<main className="sticker-loading"><span className="spinner"/><output>STICKER-WERKSTATT WIRD GELADEN</output><button className="button" onClick={() => setStickerBike(null)}>ABBRECHEN</button></main>}>
    <StickerWorkshop player={stickerBike} account={player} products={products} initialTarget={stickerTarget} onClose={() => setStickerBike(null)} onBuySticker={() => {
      const product = products.find(isSticker);
      if (!product) return;
      const next = unlock(player, product.id, digitalPrice(product));
      if (!next) { notify('Du brauchst mehr Coins.'); return; }
      update(next);
      notify('Sticker gekauft. Deine Platzierung bleibt in der Vorschau.');
    }} onSave={(drafts) => {
      const next = saveStickerTargets(player, drafts, products);
      if (!next) { notify('Sticker und gegebenenfalls das Fahrzeug zuerst freischalten.'); return; }
      update(next); setStickerBike(null); setDraft(null); notify('Sticker platziert und gespeichert.');
    }}/>
  </Suspense>;
  return (
    <main className="garage-page">
      <div className="garage-layout">
        <section className="garage-preview">
          <div className="preview-top">
            <span className="eyebrow">
              {draft ? 'VORSCHAU' : 'AKTUELLES SETUP'}
            </span>
            {embedded && <div className="garage-balance">
              <Coin value={player.coins} />
              <button className="level-chip" onClick={onProgress} aria-label={`Fortschritt, Stufe ${player.level}`}>
                ST. {String(player.level).padStart(2, '0')}
              </button>
            </div>}
            {draft && (
              <button
                className="reset-preview"
                onClick={() => {
                  setDraft(null);
                  setSelected(null);
                }}
              >
                ZUM AKTUELLEN SETUP
              </button>
            )}
          </div>
          <div
            className="garage-model"
            data-testid="garage-model"
            data-bike={appearance.bike}
            data-paint={appearance.paint}
            data-rims={appearance.rims}
            data-variant={configuration?.variantId ?? ''}
            data-product={selected?.id ?? appearance.equipped.upper ?? ''}
            data-number={
              appearance.customizations[appearance.equipped.upper ?? '']
                ?.customNumber ?? ''
            }
            data-hood={
              appearance.customizations[appearance.equipped.upper ?? '']
                ?.hoodEnabled === true
            }
            data-helmet={appearance.helmet}
            data-helmet-color={appearance.helmetColor}
            data-helmet-visor={appearance.helmetVisor}
          >
            <Preview
              player={appearance}
              products={products}
              mode="garage"
              onReady={onReady}
              onLoadError={onLoadError}
              inspectionAngle={angle}
              inspectionRevision={inspectionRevision}
            />
          </div>
          <div className="preview-bottom">
            <div className="garage-angles">
              {[
                { label: 'VORNE ¾', angle: 2.35 },
                { label: 'SEITE', angle: 1.57 },
                { label: 'HINTEN ¾', angle: 0.55 },
                { label: 'VORNE', angle: Math.PI },
              ].map((v) => (
                <button
                  key={v.label}
                  aria-label={`Inspect ${v.label}`}
                  onClick={() => {
                    setAngle(v.angle);
                    setInspectionRevision((r) => r + 1);
                  }}
                >
                  {v.label}
                </button>
              ))}
              <RotateCw size={13} />
            </div>
            <h2>{bike.name}</h2>
            <p>
              {products.find((p) => p.id === appearance.equipped.upper)
                ?.title ?? 'Standard-Outfit'}
              {draft ? ' · temporäre Vorschau' : ''}
            </p>
            <XpBar player={player} />
            <button className="button primary" onClick={start}>
              FAHRT STARTEN <ArrowRight />
            </button>
          </div>
        </section>
        <section className="garage-controls">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(String(v));
              setFilter('all');
            }}
          >
            <TabsList className="garage-tabs" variant="line">
              <TabsTrigger value="rider">FAHRER</TabsTrigger>
              <TabsTrigger value="bike">MOTORRAD</TabsTrigger>
              <TabsTrigger value="progress">FORTSCHRITT</TabsTrigger>
            </TabsList>
            <TabsContent value="rider">
              <div className="section-intro">
                <h2>KLEIDUNG</h2>
              </div>
              <div className="equipped-slots">
                {(['upper', 'head', 'accessory'] as const).map((slot) => (
                  <div key={slot}>
                    <span className="eyebrow">
                      {slot === 'upper'
                        ? 'OBERTEIL'
                        : slot === 'head' ? 'KOPFBEDECKUNG' : 'ACCESSOIRE'}
                    </span>
                    <b>
                      {products.find((p) => p.id === player.equipped[slot])
                        ?.title ?? 'Standard-Outfit'}
                    </b>
                    {player.equipped[slot] && (
                      <button
                        onClick={() => {
                          const equipped = { ...player.equipped };
                          delete equipped[slot];
                          update({ ...player, equipped });
                          setDraft(null);
                        }}
                      >
                        ENTFERNEN
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <section aria-label="Helmoptionen">
                <h3 className="custom-label">HELM</h3>
                <div className="category-filter" aria-label="Helmtyp">
                  {HELMETS.map((helmet) => (
                    <button
                      key={helmet.id}
                      aria-label={`Vorschau ${helmet.name} Helm`}
                      aria-pressed={appearance.helmet === helmet.id}
                      className={
                        appearance.helmet === helmet.id ? 'active' : ''
                      }
                      onClick={() => setDraft({ ...appearance, helmet: helmet.id })}
                    >
                      {helmet.name.toUpperCase()}
                    </button>
                  ))}
                </div>
                <ColorSection title="Helmfarbe" value={appearance.helmetColor}><div className="swatches" aria-label="Helmfarbe">
                  {visiblePalette(HELMET_COLORS, appearance.helmetColor).map((color) => (
                    <button
                      key={color.value}
                      aria-label={`${color.name} helmet color`}
                      aria-pressed={appearance.helmetColor === color.value}
                      className={
                        appearance.helmetColor === color.value ? 'selected' : ''
                      }
                      onClick={() =>
                        setDraft({ ...appearance, helmetColor: color.value })
                      }
                    >
                      <i style={{ background: color.value }} />
                      <b>{color.name}</b>
                      <span>KOSTENLOS</span>
                    </button>
                  ))}
                </div></ColorSection>
                <ColorSection title="Visier / Brillenglas" value={appearance.helmetVisor}><div className="swatches" aria-label="Visierfarbe">
                  {VISOR_COLORS.map((color) => <button key={color.value} aria-label={color.name} aria-pressed={appearance.helmetVisor === color.value} className={appearance.helmetVisor === color.value ? 'selected' : ''} onClick={() => setDraft({ ...appearance, helmetVisor: color.value })}><i style={{ background: color.value }}/><b>{color.name}</b><span>VORSCHAU</span></button>)}
                </div></ColorSection>
                <button className="button small" disabled={appearance.helmet === player.helmet && appearance.helmetColor === player.helmetColor && appearance.helmetVisor === player.helmetVisor} onClick={() => equipHelmetNow(appearance)}>HELM AUSRÜSTEN</button>
                {products.some(isSticker) && <button className="button small helmet-sticker-open" onClick={() => { setStickerTarget('helmet'); setStickerBike(appearance); }}>STICKER AUF HELM PLATZIEREN</button>}
              </section>
              {grid}
            </TabsContent>
            <TabsContent value="bike">
              <div className="section-intro">
                <h2>MOTORRÄDER</h2>
              </div>
              <div className="bike-options">
                {BIKES.map((b, i) => (
                  <article
                    key={b.id}
                    className={`bike-card ${appearance.bike === b.id ? 'selected' : ''}`}
                  >
                    <span className="bike-number">0{i + 1}</span>
                    <div className="bike-info">
                      <h3>{b.name}</h3>
                      <p>
                        {b.id === '125'
                          ? 'Leichtes Bike. Direkt und unkompliziert.'
                          : b.id === 'scooter'
                            ? 'Kleine Räder. Für die Stadt.'
                          : b.id === '450'
                            ? 'Hohe Sitzposition. Strassenreifen.'
                            : 'Vollverkleidung. Tiefe Lenkerposition.'}
                      </p>
                      <span className="eyebrow">
                        {owned(`bike:${b.id}`)
                          ? 'BESITZT'
                          : `FREISCHALTEN · LEVEL ${b.level} · ${b.price} COINS`}
                      </span>
                    </div>
                    <div className="garage-item-actions">
                      <button className="button small" aria-label={`Ansehen ${b.name}`} aria-pressed={appearance.bike === b.id}
                        onClick={() => previewBike({ bike: b.id })}>ANSEHEN</button>
                      <button className="button small" aria-label={`${owned(`bike:${b.id}`) ? 'Ausrüsten' : 'Kaufen'} ${b.name}`}
                        disabled={owned(`bike:${b.id}`) ? player.bike === b.id : player.level < b.level || player.coins < b.price}
                        onClick={() => owned(`bike:${b.id}`)
                          ? equipBikeOption({ bike: b.id })
                          : buyBikeOption(`bike:${b.id}`, b.price, b.name, b.level)}>
                        {owned(`bike:${b.id}`) ? (player.bike === b.id ? 'AUSGERÜSTET' : 'AUSRÜSTEN') : 'KAUFEN'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {colorOptions('paint')}
              {colorOptions('rims')}
              <div className="equipped-slots motorcycle-equipped">
                <div>
                  <span className="eyebrow">SCHLÜSSELANHÄNGER</span>
                  <b>
                    {products.find((p) => p.id === player.equipped.keychain)
                      ?.title ?? 'Kein Schlüsselanhänger'}
                  </b>
                  {player.equipped.keychain && (
                    <button
                      onClick={() => {
                        const equipped = { ...player.equipped };
                        delete equipped.keychain;
                        update({ ...player, equipped });
                        setDraft(null);
                      }}
                    >
                      ENTFERNEN
                    </button>
                  )}
                </div>
              </div>
              {grid}
            </TabsContent>
            <TabsContent value="progress">
              <ProgressContent player={player} />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </main>
  );
}
