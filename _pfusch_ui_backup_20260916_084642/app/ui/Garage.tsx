import { useState } from 'react';
import { ArrowRight, Check, Lock, RotateCw } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Player, Product, ProductConfiguration } from '../domain/types';
import type { Services } from '../services';
import { BIKES, PAINTS, RIMS } from '../domain/config';
import { digitalPrice, ownership, unlock } from '../domain/progression';
import { HELMETS, HELMET_COLORS, equipHelmet } from '../domain/helmet';
import {
  equipConfiguration,
  equippable,
  imagePath,
  previewLoadout,
  initialConfiguration,
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
  const [draft, setDraft] = useState<Player | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [configuration, setConfiguration] =
    useState<ProductConfiguration | null>(null);
  const [angle, setAngle] = useState(2.35);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const appearance = draft ?? player;
  const bike = BIKES.find((b) => b.id === appearance.bike)!;
  const owned = (id: string) => player.ownedItems.includes(id);
  function unlockProduct(p: Product) {
    const next = unlock(player, p.id, digitalPrice(p));
    if (next) {
      update(next);
      notify(`${p.title} digitally unlocked. Choose Equip when you are ready.`);
    } else
      notify('Earn more coins to unlock for gameplay. Preview is always free.');
  }
  function equipProduct(p: Product, config: ProductConfiguration) {
    const next = equipConfiguration(player, p, config);
    if (!next) {
      notify('Unlock this item before equipping it for gameplay.');
      return;
    }
    update(next);
    setDraft(null);
    services.analytics.track('product_equipped', { id: p.id });
    notify(`${p.title} equipped and saved.`);
  }
  function previewBike(
    values: Partial<Pick<Player, 'bike' | 'paint' | 'rims'>>,
  ) {
    setDraft({ ...appearance, ...values });
  }
  function previewHelmet(
    values: Partial<Pick<Player, 'helmet' | 'helmetColor'>>,
  ) {
    setDraft({ ...appearance, ...values });
  }
  function saveHelmet() {
    const next = equipHelmet(player, appearance);
    if (!next) return;
    update(next);
    setDraft(null);
    setSelected(null);
    setConfiguration(null);
    notify('Helmet equipped and saved.');
  }
  const helmetChanged =
    appearance.helmet !== player.helmet ||
    appearance.helmetColor !== player.helmetColor;
  const bikeSetupOwned =
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
    notify(`${bike.name} setup equipped.`);
  }
  const visible = products.filter(
    (p) => filter === 'all' || p.category === filter,
  );
  const openProduct = (p: Product) => {
    const config = initialConfiguration(appearance, p);
    setConfiguration(config);
    setDraft(previewLoadout(appearance, p, config));
    setSelected(p);
    services.analytics.track('product_viewed', { id: p.id });
  };
  const grid = (
    <>
      <div className="category-filter" aria-label="Product categories">
        {['all', 'upper', 'head', 'accessory', 'collectible'].map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            className={filter === f ? 'active' : ''}
            onClick={() => setFilter(f)}
          >
            {f === 'all'
              ? 'ALL'
              : f === 'upper'
                ? 'TOPS'
                : f === 'head'
                  ? 'HEADWEAR'
                  : f === 'accessory'
                    ? 'ACCESSORIES'
                    : 'COLLECTIBLES'}
          </button>
        ))}
      </div>
      <div className="product-grid">
        {visible.map((p) => (
          <article
            key={p.id}
            className="product-card"
            data-testid="product-card"
          >
            <button
              className="product-image product-open"
              aria-label={`Preview ${p.title}`}
              onClick={() => openProduct(p)}
            >
              <img
                src={imagePath(p.localImage ?? p.image)}
                alt={p.title}
                loading="lazy"
                width="360"
                height="360"
              />
              <span className="ownership">
                {ownership(player, p) === 'EQUIPPED'
                  ? 'EQUIPPED'
                  : ownership(player, p) === 'LOCKED'
                    ? 'FREE PREVIEW'
                    : ownership(player, p) === 'OWNED_IRL'
                      ? 'OWNED IRL'
                      : 'DIGITAL UNLOCK'}
              </span>
            </button>
            <div className="product-body">
              <p className="eyebrow">{p.type}</p>
              <h3>{p.title}</h3>
              <p className="product-price">{money(p.price)}</p>
              <button
                className="button small primary"
                onClick={() => openProduct(p)}
              >
                {equippable(p) ? 'PREVIEW / TRY ON' : 'PREVIEW PRODUCT'}
              </button>
              <a
                className="product-link"
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  services.analytics.track('product_link_clicked', { id: p.id })
                }
              >
                VIEW PRODUCT <ExternalArrow />
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
  return (
    <main className="garage-page">
      <ScreenHeading
        kicker="YOUR SPACE. YOUR SETUP."
        title="THE GARAGE."
        back={back}
      />
      <div className="garage-layout">
        <section className="garage-preview">
          <div className="preview-top">
            <span className="eyebrow">
              {draft ? 'FREE SETUP PREVIEW' : 'EQUIPPED SETUP'}
            </span>
            {draft && (
              <button
                className="reset-preview"
                onClick={() => {
                  setDraft(null);
                  setSelected(null);
                }}
              >
                RETURN TO EQUIPPED
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
            data-helmet={appearance.helmet}
            data-helmet-color={appearance.helmetColor}
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
                { label: 'FRONT ¾', angle: 2.35 },
                { label: 'SIDE', angle: 1.57 },
                { label: 'REAR ¾', angle: 0.55 },
                { label: 'FRONT', angle: Math.PI },
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
                ?.title ?? 'Crew riding kit'}
              {draft ? ' · temporary preview' : ''}
            </p>
            <XpBar player={player} />
            <button className="button primary" onClick={start}>
              RIDE EQUIPPED SETUP <ArrowRight />
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
              <TabsTrigger value="rider">RIDER</TabsTrigger>
              <TabsTrigger value="bike">BIKE</TabsTrigger>
              <TabsTrigger value="progress">PROGRESS</TabsTrigger>
            </TabsList>
            <TabsContent value="rider">
              <div className="section-intro">
                <h2>TRY IT. MAKE IT YOURS.</h2>
                <p>Every piece is free to try on, including locked gear.</p>
              </div>
              <div className="equipped-slots">
                {(['upper', 'head', 'accessory'] as const).map((slot) => (
                  <div key={slot}>
                    <span className="eyebrow">
                      {slot === 'upper'
                        ? 'TOP'
                        : slot === 'head'
                          ? 'HEADWEAR'
                          : 'ACCESSORY'}
                    </span>
                    <b>
                      {products.find((p) => p.id === player.equipped[slot])
                        ?.title ?? 'Stock riding kit'}
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
                        REMOVE
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <section aria-label="Helmet options">
                <h3 className="custom-label">HELMET</h3>
                <div className="category-filter" aria-label="Helmet style">
                  {HELMETS.map((helmet) => (
                    <button
                      key={helmet.id}
                      aria-label={`Preview ${helmet.name} helmet`}
                      aria-pressed={appearance.helmet === helmet.id}
                      className={
                        appearance.helmet === helmet.id ? 'active' : ''
                      }
                      onClick={() => previewHelmet({ helmet: helmet.id })}
                    >
                      {helmet.name.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="swatches" aria-label="Helmet color">
                  {HELMET_COLORS.map((color) => (
                    <button
                      key={color.value}
                      aria-label={`${color.name} helmet color`}
                      aria-pressed={appearance.helmetColor === color.value}
                      className={
                        appearance.helmetColor === color.value ? 'selected' : ''
                      }
                      onClick={() =>
                        previewHelmet({ helmetColor: color.value })
                      }
                    >
                      <i style={{ background: color.value }} />
                      <b>{color.name}</b>
                      <span>FREE</span>
                    </button>
                  ))}
                </div>
                <div className="bike-confirm">
                  <button
                    className="button small primary"
                    disabled={!helmetChanged}
                    onClick={saveHelmet}
                  >
                    <Check size={14} /> EQUIP HELMET
                  </button>
                  {helmetChanged && (
                    <button
                      className="button small"
                      onClick={() => {
                        setDraft(null);
                        setSelected(null);
                        setConfiguration(null);
                      }}
                    >
                      DISCARD PREVIEW
                    </button>
                  )}
                </div>
              </section>
              {selected && configuration ? (
                <ProductPreview
                  key={selected.id}
                  product={selected}
                  products={products}
                  player={player}
                  configuration={configuration}
                  onConfiguration={(c) => {
                    setConfiguration(c);
                    setDraft(previewLoadout(appearance, selected, c));
                  }}
                  onClose={() => {
                    setSelected(null);
                    setDraft(null);
                  }}
                  onKeep={() => setSelected(null)}
                  onEquip={equipProduct}
                  onUnlock={unlockProduct}
                  onLink={() =>
                    services.analytics.track('product_link_clicked', {
                      id: selected.id,
                    })
                  }
                  onSelect={openProduct}
                  onInspect={(value) => {
                    setAngle(value);
                    setInspectionRevision((r) => r + 1);
                  }}
                />
              ) : (
                grid
              )}
            </TabsContent>
            <TabsContent value="bike">
              <div className="section-intro">
                <h2>FIND YOUR RIDE.</h2>
                <p>
                  Preview every bike and finish. Your saved setup changes only
                  with Equip.
                </p>
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
                          ? 'Light frame. Easy upright riding.'
                          : b.id === 'scooter'
                            ? 'Small wheels. Open floorboard. City riding.'
                          : b.id === '450'
                            ? 'Tall stance. Road tires. Street attitude.'
                            : 'Full fairings. Low bars. Tucked posture.'}
                      </p>
                      <span className="eyebrow">
                        {owned(`bike:${b.id}`)
                          ? 'OWNED'
                          : `GAMEPLAY UNLOCK · LEVEL ${b.level} · ${b.price} COINS`}
                      </span>
                    </div>
                    <button
                      className="button small"
                      aria-label={`Preview ${b.name}`}
                      onClick={() => previewBike({ bike: b.id })}
                    >
                      PREVIEW
                    </button>
                  </article>
                ))}
              </div>
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
                    if (p) update(p);
                  }}
                >
                  {player.level < bike.level ? (
                    <>
                      <Lock size={14} /> GAMEPLAY UNLOCK AT LEVEL {bike.level}
                    </>
                  ) : (
                    <>
                      <Coin value={bike.price} /> UNLOCK{' '}
                      {bike.name.toUpperCase()}
                    </>
                  )}
                </button>
              )}
              <h3 className="custom-label">PAINT / BODYWORK</h3>
              <div className="swatches">
                {PAINTS.map((c) => (
                  <button
                    key={c.value}
                    aria-label={`${c.name} paint`}
                    aria-pressed={appearance.paint === c.value}
                    className={appearance.paint === c.value ? 'selected' : ''}
                    onClick={() => previewBike({ paint: c.value })}
                  >
                    <i style={{ background: c.value }} />
                    <b>{c.name}</b>
                    <span>
                      {owned(`paint:${c.value}`) ? 'OWNED' : 'FREE PREVIEW'}
                    </span>
                  </button>
                ))}
              </div>
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
                    if (p) update(p);
                  }}
                >
                  UNLOCK PAINT ·{' '}
                  {PAINTS.find((c) => c.value === appearance.paint)?.price}{' '}
                  COINS
                </button>
              )}
              <h3 className="custom-label">RIMS / FINISH</h3>
              <div className="swatches">
                {RIMS.map((c) => (
                  <button
                    key={c.value}
                    aria-label={`${c.name} rims`}
                    aria-pressed={appearance.rims === c.value}
                    className={appearance.rims === c.value ? 'selected' : ''}
                    onClick={() => previewBike({ rims: c.value })}
                  >
                    <i style={{ background: c.value }} />
                    <b>{c.name}</b>
                    <span>
                      {owned(`rims:${c.value}`) ? 'OWNED' : 'FREE PREVIEW'}
                    </span>
                  </button>
                ))}
              </div>
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
                    if (p) update(p);
                  }}
                >
                  UNLOCK RIMS ·{' '}
                  {RIMS.find((c) => c.value === appearance.rims)?.price} COINS
                </button>
              )}
              <div className="bike-confirm">
                <button
                  className="button primary"
                  disabled={!bikeSetupOwned || player.level < bike.level}
                  onClick={equipBike}
                >
                  <Check size={16} /> EQUIP BIKE SETUP
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setDraft(null);
                    setSelected(null);
                  }}
                >
                  RESET PREVIEW
                </button>
              </div>
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
