import { useEffect, useState } from 'react';
import { loadNumberFont } from '../game/numberFont';
import { ArrowLeft, ArrowRight, Check, Lock } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Player, Product, ProductConfiguration } from '../domain/types';
import {
  canEquip,
  equippable,
  imagePath,
  productColors,
  validConfiguration,
} from '../domain/preview';
import { ownership, digitalPrice } from '../domain/progression';
import { Coin, ExternalArrow, money } from './shared';
interface Props {
  product: Product;
  products: Product[];
  player: Player;
  configuration: ProductConfiguration;
  onConfiguration: (c: ProductConfiguration) => void;
  onClose: () => void;
  onKeep: () => void;
  onEquip: (p: Product, c: ProductConfiguration) => void;
  onUnlock: (p: Product) => void;
  onLink: () => void;
  onSelect: (p: Product) => void;
  onInspect: (angle: number) => void;
}
/** Controls only: all changes update the persistent Garage renderer. */
export default function ProductPreview({
  product,
  products,
  player,
  configuration,
  onConfiguration,
  onClose,
  onKeep,
  onEquip,
  onUnlock,
  onLink,
  onSelect,
  onInspect,
}: Props) {
  const [view, setView] = useState<'front' | 'back'>('front');
  const colors = productColors(product),
    color =
      colors.find((c) => c.variantIds.includes(configuration.variantId)) ??
      colors[0];
  const variant =
      product.variants.find((v) => v.id === configuration.variantId) ??
      product.variants[0],
    selectedImage = view === 'back' && color.back ? color.back : color.front;
  const src =
    selectedImage?.localImage ??
    variant?.image ??
    product.localImage ??
    product.image;
  const permanent = canEquip(player, product),
    state = ownership(player, product),
    numberEnabled = product.preview?.numberCustomization;
  const [numberFont, setNumberFont] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  useEffect(() => {
    if (!numberEnabled) return;
    let active = true;
    void loadNumberFont()
      .then(() => {
        if (active) setNumberFont('ready');
      })
      .catch(() => {
        if (active) setNumberFont('error');
      });
    return () => {
      active = false;
    };
  }, [numberEnabled]);
  const exact =
    state === 'EQUIPPED' &&
    player.variants[product.id] === configuration.variantId &&
    (!numberEnabled ||
      player.customizations[product.id]?.customNumber ===
        configuration.customNumber);
  function chooseColor(id: string) {
    const next = colors.find((c) => c.id === id);
    if (next) {
      onConfiguration({ ...configuration, variantId: next.variantIds[0] });
      if (!next.back) setView('front');
    }
  }
  return (
    <section
      className="garage-product-panel"
      aria-label={`${product.title} preview controls`}
      data-testid="product-preview-panel"
    >
      <header className="product-preview-header">
        <button className="button small" onClick={onClose}>
          <ArrowLeft size={14} /> LEAVE PREVIEW
        </button>
        <div className="product-paging">
          {[-1, 1].map((direction) => (
            <button
              key={direction}
              className="icon-button"
              aria-label={direction < 0 ? 'Previous product' : 'Next product'}
              onClick={() =>
                onSelect(
                  products[
                    (products.findIndex((p) => p.id === product.id) +
                      direction +
                      products.length) %
                      products.length
                  ],
                )
              }
            >
              {direction < 0 ? (
                <ArrowLeft size={17} />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          ))}
        </div>
      </header>
      <div className="product-detail">
        <p className="eyebrow">PFUSCH CLOTHING / {product.type}</p>
        <h2>{product.title}</h2>
        <div className="detail-price">
          <strong>{money(variant?.price ?? product.price)}</strong>
          <span>{variant?.available ? 'IN STOCK' : 'SOLD OUT'}</span>
        </div>
        <div className="product-view-controls">
          <button
            aria-pressed={view === 'front'}
            onClick={() => {
              setView('front');
              onInspect(Math.PI);
            }}
          >
            FRONT
          </button>
          <button
            aria-pressed={view === 'back'}
            disabled={!color.back}
            onClick={() => {
              setView('back');
              onInspect(0);
            }}
          >
            BACK{!color.back ? ' · NOT PUBLISHED' : ''}
          </button>
          <span>ON RIDER / GARAGE VIEW</span>
        </div>
        <div className="authoritative-image">
          <img
            src={imagePath(src)}
            alt={`${product.title} — ${color.label} — ${view}`}
            data-testid="preview-product-image"
          />
          <span>{view.toUpperCase()} / REAL PRODUCT IMAGE</span>
        </div>
        <p className="preview-source-note">
          Shop photographs show the actual product; try colors and fit on your
          rider in the Garage.
          {product.category === 'head'
            ? ' Caps are carried at the hip with the riding helmet on.'
            : ''}
        </p>
        <div className="preview-colors">
          <p className="preview-field-label">
            COLOR <b>{color.label}</b>
          </p>
          <div>
            {colors.map((c) => (
              <button
                key={c.id}
                aria-label={`Color ${c.label}`}
                aria-pressed={color.id === c.id}
                onClick={() => chooseColor(c.id)}
              >
                <i style={{ background: c.baseColor }} />
                {c.label}
                {color.id === c.id && <Check size={13} />}
              </button>
            ))}
          </div>
        </div>
        {color.variantIds.length > 1 && (
          <div className="preview-variant">
            <label htmlFor="preview-variant">SIZE / VARIANT</label>
            <Select
              value={configuration.variantId}
              onValueChange={(id) => {
                if (id) onConfiguration({ ...configuration, variantId: id });
              }}
              items={product.variants
                .filter((v) => color.variantIds.includes(v.id))
                .map((v) => ({ value: v.id, label: v.title }))}
            >
              <SelectTrigger
                id="preview-variant"
                className="variant-select"
                aria-label="Preview size or variant"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {product.variants
                  .filter((v) => color.variantIds.includes(v.id))
                  .map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {numberEnabled && (
          <div className="number-customization">
            <label htmlFor="zipper-number">
              YOUR BACK NUMBER{' '}
              <small>1–2 digits · Merriweather · free to preview</small>
            </label>
            {numberFont === 'ready' ? (
              <>
                <input
                  id="zipper-number"
                  aria-label="Zipper number"
                  value={configuration.customNumber ?? ''}
                  inputMode="numeric"
                  pattern="[0-9]{1,2}"
                  maxLength={2}
                  onChange={(e) =>
                    onConfiguration({
                      ...configuration,
                      customNumber: e.target.value
                        .replace(/\D/g, '')
                        .slice(0, 2),
                    })
                  }
                />
                <output
                  className="number-proof"
                  aria-label="Number customization preview"
                >
                  {configuration.customNumber || '—'}
                </output>
              </>
            ) : (
              <output>
                {numberFont === 'error'
                  ? 'Number font could not load. Reload to try again.'
                  : 'Loading number type…'}
              </output>
            )}
            <p>
              The shop photo includes example 23. Your number appears on the
              Garage rider.
            </p>
          </div>
        )}
        <p className="detail-description">{product.description}</p>
        <div className="preview-actions">
          {equippable(product) && (
            <button
              className="button primary"
              disabled={!validConfiguration(product, configuration)}
              onClick={onKeep}
            >
              KEEP IN TRY-ON SETUP
            </button>
          )}
          {permanent ? (
            <button
              className="button"
              disabled={exact || !validConfiguration(product, configuration)}
              onClick={() => onEquip(product, configuration)}
            >
              {exact ? 'EQUIPPED' : 'EQUIP FOR GAMEPLAY'}
            </button>
          ) : (
            <>
              <p className="gameplay-lock">
                <Lock size={13} />
                {equippable(product)
                  ? 'LOCKED FOR GAMEPLAY · FREE TO TRY ON'
                  : 'DIGITAL COLLECTIBLE'}
              </p>
              <button
                className="button"
                disabled={
                  player.coins < digitalPrice(product) || state !== 'LOCKED'
                }
                onClick={() => onUnlock(product)}
              >
                {state === 'LOCKED' ? (
                  <>
                    <Coin value={digitalPrice(product)} /> UNLOCK DIGITAL
                  </>
                ) : (
                  'COLLECTED'
                )}
              </button>
            </>
          )}
          <a
            className="product-link"
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onLink}
          >
            VIEW PRODUCT <ExternalArrow />
          </a>
        </div>
      </div>
    </section>
  );
}
