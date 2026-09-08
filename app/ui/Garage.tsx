import { useState } from 'react';
import { ArrowRight, Check, Lock, RotateCw, Shirt } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Player, Product } from '../domain/types';
import type { Services } from '../services';
import { BIKES, PAINTS, RIMS } from '../domain/config';
import { digitalPrice, ownership, unlock } from '../domain/progression';
import {
  Coin,
  ExternalArrow,
  Preview,
  ScreenHeading,
  XpBar,
  money,
} from './shared';
import { ProgressContent } from './Screens';
interface Props {
  player: Player;
  products: Product[];
  update: (p: Player) => void;
  services: Services;
  notify: (s: string) => void;
  back: () => void;
  start: () => void;
}
const labels = {
  upper: 'TOPS',
  head: 'HEADWEAR',
  accessory: 'ACCESSORIES',
  collectible: 'COLLECTIBLES',
  lower: 'PANTS',
  bike: 'BIKE GEAR',
};
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
  const bike = BIKES.find((b) => b.id === player.bike)!;
  function equip(product: Product, variantId?: string) {
    let p = player;
    const state = ownership(p, product);
    if (state === 'LOCKED') {
      const bought = unlock(p, product.id, digitalPrice(product));
      if (!bought) {
        notify(
          `You need ${digitalPrice(product)} coins to unlock this digital item.`,
        );
        return;
      }
      p = bought;
    }
    if (product.category === 'collectible') {
      update(p);
      notify(`${product.title} added to your collection.`);
      return;
    }
    update({
      ...p,
      equipped: { ...p.equipped, [product.category]: product.id },
      variants: {
        ...p.variants,
        [product.id]:
          variantId ?? p.variants[product.id] ?? product.variants[0]?.id,
      },
    });
    services.analytics.track('product_equipped', { id: product.id });
    notify(`${product.title} equipped.`);
  }
  function customize(kind: 'paint' | 'rims', value: string, price: number) {
    const p = unlock(player, `${kind}:${value}`, price);
    if (!p) {
      notify(`Earn ${price} coins to unlock this finish.`);
      return;
    }
    update({ ...p, [kind]: value });
  }
  const visibleProducts = products.filter(
    (p) =>
      (tab !== 'rider' ||
        ['upper', 'head', 'accessory', 'lower'].includes(p.category)) &&
      (filter === 'all' || p.category === filter),
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
            <span className="eyebrow">{bike.tag}</span>
            <span className="preview-indicator">
              <i /> LIVE PREVIEW
            </span>
          </div>
          <div className="garage-model">
            <Preview player={player} products={products} mode="garage" />
          </div>
          <div className="preview-bottom">
            <span>
              <RotateCw size={15} /> DRAG TO ROTATE
            </span>
            <h2>{bike.name}</h2>
            <p>
              {products.find((p) => p.id === player.equipped.upper)?.title ??
                'PFUSCH crew riding kit'}
            </p>
            <XpBar player={player} />
            <button className="button primary" onClick={start}>
              TAKE IT OUT <ArrowRight />
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
              <TabsTrigger value="gear">GEAR / SHOP</TabsTrigger>
              <TabsTrigger value="progress">PROGRESS</TabsTrigger>
            </TabsList>
            <TabsContent value="rider">
              <div className="section-intro">
                <h2>WEAR YOUR ATTITUDE.</h2>
                <p>Real PFUSCH gear. Your digital riding kit.</p>
              </div>
              <div className="equipped-slots">
                {(['upper', 'head', 'accessory'] as const).map((slot) => (
                  <div key={slot}>
                    <span className="eyebrow">{labels[slot]}</span>
                    <b>
                      {products.find((p) => p.id === player.equipped[slot])
                        ?.title ??
                        (slot === 'upper'
                          ? 'Crew riding kit'
                          : slot === 'head'
                            ? 'Stock helmet'
                            : 'None')}
                    </b>
                    {player.equipped[slot] && (
                      <button
                        onClick={() => {
                          const equipped = { ...player.equipped };
                          delete equipped[slot];
                          update({ ...player, equipped });
                        }}
                      >
                        REMOVE
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="mini-note">
                Headwear colors personalize your riding helmet. Clothes use
                stylized garment templates.
              </p>
              <ProductGrid />
            </TabsContent>
            <TabsContent value="bike">
              <div className="section-intro">
                <h2>PICK YOUR SINGLE.</h2>
                <p>Three setups. The same streets.</p>
              </div>
              <div className="bike-options">
                {BIKES.map((b, i) => {
                  const owned = player.ownedItems.includes(`bike:${b.id}`);
                  const selected = player.bike === b.id;
                  return (
                    <article
                      className={`bike-card ${selected ? 'selected' : ''}`}
                      key={b.id}
                    >
                      <div className="bike-number">0{i + 1}</div>
                      <div className="bike-info">
                        <span className="eyebrow">{b.tag}</span>
                        <h3>{b.name}</h3>
                        <div className="bike-bars">
                          {[
                            ['ACCEL.', b.acceleration / 0.3],
                            ['HANDLING', b.handling / 16],
                            ['STABILITY', b.stability / 1.2],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <span>{label}</span>
                              <i>
                                <b
                                  style={{ width: `${Number(value) * 100}%` }}
                                />
                              </i>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button
                        className={`button small ${selected ? 'equipped' : ''}`}
                        disabled={
                          selected ||
                          player.level < b.level ||
                          (!owned && player.coins < b.price)
                        }
                        onClick={() => {
                          const p = unlock(
                            player,
                            `bike:${b.id}`,
                            b.price,
                            b.level,
                          );
                          if (p) {
                            update({ ...p, bike: b.id });
                            notify(`${b.name} ready to ride.`);
                          }
                        }}
                      >
                        {selected ? (
                          <>
                            <Check size={14} /> EQUIPPED
                          </>
                        ) : player.level < b.level ? (
                          <>
                            <Lock size={14} /> LVL {b.level}
                          </>
                        ) : owned ? (
                          'EQUIP'
                        ) : (
                          <Coin value={b.price} />
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
              <h3 className="custom-label">PAINT / BODYWORK</h3>
              <div className="swatches">
                {PAINTS.map((c) => (
                  <button
                    key={c.value}
                    className={player.paint === c.value ? 'selected' : ''}
                    onClick={() => customize('paint', c.value, c.price)}
                    aria-label={`${c.name} paint`}
                    aria-pressed={player.paint === c.value}
                  >
                    <i style={{ background: c.value }} />
                    <b>{c.name}</b>
                    <span>
                      {player.ownedItems.includes(`paint:${c.value}`)
                        ? 'OWNED'
                        : `${c.price} C`}
                    </span>
                  </button>
                ))}
              </div>
              <h3 className="custom-label">RIMS / FINISH</h3>
              <div className="swatches">
                {RIMS.map((c) => (
                  <button
                    key={c.value}
                    className={player.rims === c.value ? 'selected' : ''}
                    onClick={() => customize('rims', c.value, c.price)}
                    aria-label={`${c.name} rims`}
                    aria-pressed={player.rims === c.value}
                  >
                    <i style={{ background: c.value }} />
                    <b>{c.name}</b>
                    <span>
                      {player.ownedItems.includes(`rims:${c.value}`)
                        ? 'OWNED'
                        : `${c.price} C`}
                    </span>
                  </button>
                ))}
              </div>
              <h3 className="custom-label">NUMBER PLATE</h3>
              <div className="decal-options">
                <button
                  className={`button ${player.decal === 'PFUSCH' ? 'equipped' : ''}`}
                  onClick={() => update({ ...player, decal: 'PFUSCH' })}
                >
                  PFUSCH / P
                </button>
                <button
                  className={`button ${player.decal === '01' ? 'equipped' : ''}`}
                  disabled={!player.ownedItems.includes('decal:01')}
                  onClick={() => update({ ...player, decal: '01' })}
                >
                  {player.ownedItems.includes('decal:01')
                    ? 'CREW / 01'
                    : 'CREW / 01 · LEVEL 3 REWARD'}
                </button>
              </div>
            </TabsContent>
            <TabsContent value="gear">
              <div className="section-intro">
                <h2>FROM STREET TO SCREEN.</h2>
                <p>
                  All {products.length} PFUSCH products. Shop prices in CHF;
                  digital unlocks use earned coins.
                </p>
              </div>
              <ProductGrid />
              <p className="catalog-note">
                Shop snapshot: 8 September 2026. Live price and stock are
                confirmed on the product page. Digital unlocks do not include
                the physical product.
              </p>
            </TabsContent>
            <TabsContent value="progress">
              <ProgressContent player={player} />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </main>
  );
  function ProductGrid() {
    return (
      <>
        <div className="category-filter" aria-label="Product categories">
          {[
            'all',
            'upper',
            'head',
            'accessory',
            ...(tab === 'gear' ? ['collectible'] : []),
          ].map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'ALL' : labels[f as keyof typeof labels]}
            </button>
          ))}
        </div>
        <div className="product-grid">
          {visibleProducts.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              player={player}
              equip={equip}
              services={services}
            />
          ))}
        </div>
        {visibleProducts.length === 0 && (
          <p className="empty">Nothing in this category yet.</p>
        )}
      </>
    );
  }
}
function ProductCard({
  product: p,
  player,
  equip,
  services,
}: {
  product: Product;
  player: Player;
  equip: (p: Product, variant?: string) => void;
  services: Services;
}) {
  const [variant, setVariant] = useState(
    player.variants[p.id] ?? p.variants[0]?.id ?? '',
  );
  const state = ownership(player, p);
  const owned = state !== 'LOCKED';
  const chosen = p.variants.find((v) => v.id === variant);
  return (
    <article className="product-card" data-testid="product-card">
      <div className="product-image">
        <img
          src={p.localImage ? `/${p.localImage}` : p.image}
          alt={p.title}
          loading="lazy"
          width="360"
          height="360"
        />
        <span className={`ownership ${state === 'EQUIPPED' ? 'active' : ''}`}>
          {state === 'EQUIPPED' ? (
            <>
              <Check size={12} /> EQUIPPED
            </>
          ) : state === 'LOCKED' ? (
            <>
              <Lock size={12} /> DIGITAL LOCK
            </>
          ) : state === 'OWNED_IRL' ? (
            'OWNED IRL'
          ) : (
            'DIGITAL UNLOCK'
          )}
        </span>
      </div>
      <div className="product-body">
        <span className="eyebrow">{labels[p.category]}</span>
        <h3>{p.title}</h3>
        <p className="product-price">
          {money(chosen?.price ?? p.price)}{' '}
          <span>
            {(chosen?.available ?? p.available) ? 'IN STOCK' : 'SOLD OUT'}
          </span>
        </p>
        <p className="product-description">{p.description}</p>
        {p.variants.length > 1 && (
          <Select
            value={variant}
            onValueChange={(v) => {
              if (v) setVariant(v);
            }}
            items={p.variants.map((v) => ({ value: v.id, label: v.title }))}
          >
            <SelectTrigger
              className="variant-select"
              aria-label={`Variant for ${p.title}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {p.variants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <button
          className={`button small ${state === 'EQUIPPED' && variant === player.variants[p.id] ? 'equipped' : ''}`}
          disabled={
            (state === 'EQUIPPED' && variant === player.variants[p.id]) ||
            (p.category === 'collectible' && owned) ||
            (!owned && player.coins < digitalPrice(p))
          }
          onClick={() => equip(p, variant)}
        >
          {p.category === 'collectible' && owned ? (
            'COLLECTED'
          ) : state === 'EQUIPPED' && variant === player.variants[p.id] ? (
            'EQUIPPED'
          ) : owned ? (
            <>
              <Shirt size={14} /> EQUIP
            </>
          ) : (
            <>
              <Coin value={digitalPrice(p)} /> UNLOCK DIGITAL
            </>
          )}
        </button>
        <a
          className="product-link"
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            services.analytics.track('product_viewed', { id: p.id });
            services.analytics.track('product_link_clicked', { id: p.id });
          }}
        >
          VIEW PRODUCT <ExternalArrow />
        </a>
      </div>
    </article>
  );
}
