import { lazy, Suspense, useState } from 'react';
import { ArrowRight, Check, Lock, RotateCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Player, Product, ProductConfiguration } from '../domain/types';
import type { Services } from '../services';
import { BIKES, PAINTS, RIMS } from '../domain/config';
import { digitalPrice, ownership, unlock } from '../domain/progression';
import { HELMETS, HELMET_COLORS, VISOR_COLORS, equipHelmet } from '../domain/helmet';
import { isSticker, saveStickers } from '../domain/stickers';
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
  ExternalArrow,
  Preview,
  ScreenHeading,
  XpBar,
  money,
} from './shared';
import { ProgressContent } from './Screens';
import ProductPreview from './ProductPreview';
import ColorSection from './ColorSection';
import { visiblePalette } from '../domain/paletteView';
const StickerWorkshop = lazy(() => import('./StickerWorkshop'));
interface Props {
  player: Player;
  products: Product[];
  update: (p: Player) => void;
  services: Services;
  notify: (s: string) => void;
  back: () => void;
  start: () => void;
}
export default function Garage({
  player,
  products,
  update,
  services,
  notify,
  back,
  start,
}: Props) {
  const [tab, setTab] = useState('rider');
  const [filter, setFilter] = useState('all');
  const [productViews, setProductViews] = useState<
    Record<string, 'front' | 'back'>
  >({});
  const [draft, setDraft] = useState<Player | null>(null);
  const [stickerBike, setStickerBike] = useState<Player | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [configuration, setConfiguration] =
    useState<ProductConfiguration | null>(null);
  const [angle, setAngle] = useState(2.35);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const appearance = draft ?? player;
  const bike = BIKES.find((b) => b.id === appearance.bike) ?? BIKES[0];
  const owned = (id: string) => player.ownedItems.includes(id);
  function unlockProduct(p: Product, config: ProductConfiguration) {
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
  }const bikeSetupOwned =
    owned(`bike:${appearance.bike}`) &&
    owned(`paint:${appearance.paint}`) &&
    owned(`rims:${appearance.rims}`);
  function equipBike() {
    if (!bikeSetupOwned || player.level < bike.level) return;
    update({
      ...player,
      bike: appearance.bike,
      paint: appearance.paint,
      rims: appearance.rims,
    });
    setDraft(null);
    notify(`${bike.name} Setup ausgerüstet.`);
  }
  const isMotorcycleProduct = (p: Product) =>
    p.category === 'bike' || p.handle === 'schlusselanhanger' || isSticker(p);
  const visible = products.filter((p) => {
    const motorcycleItem = isMotorcycleProduct(p);
    if (tab === 'bike') {
      return motorcycleItem && (filter === 'all' || filter === 'motorcycle');
    }
    return !motorcycleItem && (filter === 'all' || p.category === filter);
  });
  const openProduct = (p: Product) => {
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
        {visible.map((p) => {
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
          const exact =
            isEquipped &&
            baseConfig.variantId === config.variantId &&
            baseConfig.customNumber === config.customNumber &&
            baseConfig.hoodEnabled === config.hoodEnabled;
          const canWear = equippable(p);
          return (
            <article
              key={p.id}
              className="product-card compact-product-card"
              data-testid="product-card"
            >
              <button
                className="product-image product-open"
                aria-label={`${isOwned && canWear ? 'Ausrüsten' : 'Ansehen'} ${p.title}`}
                onClick={() => {
                  if (isOwned && canWear) {
                    equipProduct(p, config);
                  } else openProduct(p);
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
                {hasFrontAndBack && (
                  <>
                    <span
                      className="mockup-arrow mockup-arrow-left"
                      role="button"
                      aria-label={`${p.title} vorherige Ansicht`}
                      tabIndex={0}
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
                    </span>
                    <span
                      className="mockup-arrow mockup-arrow-right"
                      role="button"
                      aria-label={`${p.title} nächste Ansicht`}
                      tabIndex={0}
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
                    </span>
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
              </button>
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
                {isSticker(p) && (
                  <button
                    className="button small"
                    onClick={() => setStickerBike(appearance)}
                  >
                    AUF FAHRZEUG PLATZIEREN
                  </button>
                )}
                <div className="product-actions">
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
                      } else if (canWear && !exact) {
                        equipProduct(p, config);
                      }
                    }}
                  >
                    {exact
                      ? 'AUSGERÜSTET'
                      : state === 'LOCKED'
                        ? `KAUFEN · ${digitalPrice(p)} COINS`
                        : canWear
                          ? 'AUSRÜSTEN'
                          : 'GEKAUFT'}
                  </button>
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
                  {isEquipped && (
                    <button
                      className="button small product-unequip"
                      onClick={() => unequipProduct(p)}
                    >
                      ABLEGEN
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
  if (stickerBike) return <Suspense fallback={<main className="sticker-loading"><span className="spinner"/><output>STICKER-WERKSTATT WIRD GELADEN</output><button className="button" onClick={() => setStickerBike(null)}>ABBRECHEN</button></main>}>
    <StickerWorkshop player={stickerBike} account={player} products={products} onClose={() => setStickerBike(null)} onBuySticker={() => {
      const product = products.find(isSticker);
      if (!product) return;
      const next = unlock(player, product.id, digitalPrice(product));
      if (!next) { notify('Du brauchst mehr Coins.'); return; }
      update(next);
      notify('Sticker gekauft. Deine Platzierung bleibt in der Vorschau.');
    }} onSave={(placements) => {
      const next = saveStickers(player, stickerBike.bike, placements, products);
      if (!next) { notify('Fahrzeug und Sticker zuerst freischalten.'); return; }
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
              FAHREN <ArrowRight />
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
                    <button
                      className="button small"
                      aria-label={`${owned(`bike:${b.id}`) ? 'Ausrüsten' : 'Ansehen'} ${b.name}`}
                      disabled={owned(`bike:${b.id}`) && player.bike === b.id}
                      onClick={() => {
                        if (owned(`bike:${b.id}`)) {
                          update({ ...player, bike: b.id });
                          setDraft(null);
                          notify(`${b.name} ausgerüstet.`);
                        } else {
                          previewBike({ bike: b.id });
                        }
                      }}
                    >
                      {owned(`bike:${b.id}`)
                        ? player.bike === b.id
                          ? 'AUSGERÜSTET'
                          : 'AUSRÜSTEN'
                        : 'ANSEHEN'}
                    </button>
                  </article>
                ))}
              </div>
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
              {!owned(`bike:${bike.id}`) && (
                <button
                  className="button bike-unlock"
                  disabled={
                    player.level < bike.level || player.coins < bike.price
                  }
                  onClick={() => {
                    const p = unlock(
                      player,
                      `bike:${bike.id}`,
                      bike.price,
                      bike.level,
                    );
                    if (p) {
                      update({ ...p, bike: bike.id });
                      setDraft(null);
                      notify(`${bike.name} freigeschaltet und direkt ausgerüstet.`);
                    }
                  }}
                >
                  {player.level < bike.level ? (
                    <>
                      <Lock size={14} /> FREISCHALTEN AB LEVEL {bike.level}
                    </>
                  ) : (
                    <>
                      <Coin value={bike.price} /> FREISCHALTEN{' '}
                      {bike.name.toUpperCase()}
                    </>
                  )}
                </button>
              )}
              
              <ColorSection title="Lackfarbe" value={appearance.paint}><div className="swatches">
                {visiblePalette(PAINTS, appearance.paint).map((c) => (
                  <button
                    key={c.value}
                    aria-label={`${c.name} paint`}
                    aria-pressed={appearance.paint === c.value}
                    className={appearance.paint === c.value ? 'selected' : ''}
                    onClick={() => {
                      if (owned(`paint:${c.value}`)) {
                        update({ ...player, paint: c.value });
                        setDraft(null);
                        notify(`${c.name} ausgerüstet.`);
                      } else {
                        previewBike({ paint: c.value });
                      }
                    }}
                  >
                    <i style={{ background: c.value }} />
                    <b>{c.name}</b>
                    <span>
                      {owned(`paint:${c.value}`)
                        ? player.paint === c.value
                          ? 'AUSGERÜSTET'
                          : 'AUSRÜSTEN'
                        : 'ANSEHEN'}
                    </span>
                  </button>
                ))}
              </div></ColorSection>
              {!owned(`paint:${appearance.paint}`) && (
                <button
                  className="button small finish-unlock"
                  disabled={
                    player.coins <
                    (PAINTS.find((c) => c.value === appearance.paint)?.price ??
                      0)
                  }
                  onClick={() => {
                    const c = PAINTS.find((c) => c.value === appearance.paint)!;
                    const p = unlock(player, `paint:${c.value}`, c.price);
                    if (p) {
                      update({ ...p, paint: c.value });
                      setDraft(null);
                      notify(`${c.name} freigeschaltet und direkt ausgerüstet.`);
                    }
                  }}
                >
                  FARBE FREISCHALTEN ·{' '}
                  {PAINTS.find((c) => c.value === appearance.paint)?.price}{' '}
                  COINS
                </button>
              )}
              
              <ColorSection title="Felgenfarbe" value={appearance.rims}><div className="swatches">
                {visiblePalette(RIMS, appearance.rims).map((c) => (
                  <button
                    key={c.value}
                    aria-label={`${c.name} rims`}
                    aria-pressed={appearance.rims === c.value}
                    className={appearance.rims === c.value ? 'selected' : ''}
                    onClick={() => {
                      if (owned(`rims:${c.value}`)) {
                        update({ ...player, rims: c.value });
                        setDraft(null);
                        notify(`${c.name} ausgerüstet.`);
                      } else {
                        previewBike({ rims: c.value });
                      }
                    }}
                  >
                    <i style={{ background: c.value }} />
                    <b>{c.name}</b>
                    <span>
                      {owned(`rims:${c.value}`)
                        ? player.rims === c.value
                          ? 'AUSGERÜSTET'
                          : 'AUSRÜSTEN'
                        : 'ANSEHEN'}
                    </span>
                  </button>
                ))}
              </div></ColorSection>
              {!owned(`rims:${appearance.rims}`) && (
                <button
                  className="button small finish-unlock"
                  disabled={
                    player.coins <
                    (RIMS.find((c) => c.value === appearance.rims)?.price ?? 0)
                  }
                  onClick={() => {
                    const c = RIMS.find((c) => c.value === appearance.rims)!;
                    const p = unlock(player, `rims:${c.value}`, c.price);
                    if (p) {
                      update({ ...p, rims: c.value });
                      setDraft(null);
                      notify(`${c.name} freigeschaltet und direkt ausgerüstet.`);
                    }
                  }}
                >
                  FELGEN FREISCHALTEN ·{' '}
                  {RIMS.find((c) => c.value === appearance.rims)?.price} COINS
                </button>
              )}
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
