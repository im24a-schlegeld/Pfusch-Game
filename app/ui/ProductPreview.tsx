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
  onUnlock: (p: Product, c: ProductConfiguration) => void;
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
      aria-label={`${product.title} Vorschau-Steuerung`}
      data-testid="product-preview-panel"
    >
      <header className="product-preview-header">
        <button className="button small" onClick={onClose}>
          <ArrowLeft size={14} /> VORSCHAU SCHLIESSEN
        </button>
        <div className="product-paging">
          {[-1, 1].map((direction) => (
            <button
              key={direction}
              className="icon-button"
              aria-label={direction < 0 ? 'Vorheriges Produkt' : 'Nächstes Produkt'}
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
          <span>{variant?.available ? 'VERFÜGBAR' : 'AUSVERKAUFT'}</span>
        </div>
        <div className="product-view-controls">
          <button
            aria-pressed={view === 'front'}
            onClick={() => {
              setView('front');
              onInspect(Math.PI);
            }}
          >
            VORNE
          </button>
          <button
            aria-pressed={view === 'back'}
            disabled={!color.back}
            onClick={() => {
              setView('back');
              onInspect(0);
            }}
          >
            HINTEN{!color.back ? ' · NICHT VERÖFFENTLICHT' : ''}
          </button>
          <span>AM FAHRER / GARAGE</span>
        </div>
        <div className="authoritative-image">
          <img
            src={imagePath(src)}
            alt={`${product.title} — ${color.label} — ${view}`}
            data-testid="preview-product-image"
          />
          <span>{view.toUpperCase()} / ECHTES PRODUKTBILD</span>
        </div>
        <p className="preview-source-note">
          Die Shop-Fotos zeigen das echte Produkt. Farben und Passform kannst du direkt am Fahrer in der Garage ansehen.
          {product.category === 'head'
            ? ' Caps are carried at the hip with the riding helmet on.'
            : ''}
        </p>
        <div className="preview-colors">
          <p className="preview-field-label">
            FARBE <b>{color.label}</b>
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
            <label htmlFor="preview-variant">GRÖSSE / VARIANTE</label>
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
                aria-label="Grösse oder Variante"
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
              DEINE RÜCKENNUMMER{' '}
              <small>1–2 Ziffern · kostenlose Vorschau</small>
            </label>
            {numberFont === 'ready' ? (
              <>
                <input
                  id="zipper-number"
                  aria-label="Rückennummer"
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
                  aria-label="Vorschau Rückennummer"
                >
                  {configuration.customNumber || '—'}
                </output>
              </>
            ) : (
              <output>
                {numberFont === 'error'
                  ? 'Schrift konnte nicht geladen werden. Bitte neu laden.'
                  : 'Schrift wird geladen…'}
              </output>
            )}
            <p>
              Das Shop-Foto zeigt die Beispielnummer 23. Deine Nummer erscheint am Fahrer in der Garage.
            </p>
          </div>
        )}
        <p className="detail-description">{product.description}</p>
        <div className="preview-actions">
          {permanent ? (
            <button
              className="button"
              disabled={exact || !validConfiguration(product, configuration)}
              onClick={() => onEquip(product, configuration)}
            >
              {exact ? 'AUSGERÜSTET' : 'FÜRS SPIEL AUSRÜSTEN'}
            </button>
          ) : (
            <>
              <p className="gameplay-lock">
                <Lock size={13} />
                {equippable(product)
                  ? 'FÜRS SPIEL GESPERRT · VORSCHAU KOSTENLOS'
                  : 'DIGITALES SAMMELSTÜCK'}
              </p>
              <button
                className="button"
                disabled={
                  player.coins < digitalPrice(product) || state !== 'LOCKED'
                }
                onClick={() => onUnlock(product, configuration)}
              >
                {state === 'LOCKED' ? (
                  <>
                    <Coin value={digitalPrice(product)} /> DIGITAL FREISCHALTEN
                  </>
                ) : (
                  'ERHALTEN'
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
            PRODUKT IM SHOP <ExternalArrow />
          </a>
        </div>
      </div>
    </section>
  );
}
