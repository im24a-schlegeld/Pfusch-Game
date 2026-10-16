import type { Player, Product } from '../domain/types';
import { finishSwatch } from '../domain/carbon';
import { BIKES, PAINTS, RIMS } from '../domain/config';
import { HELMETS, HELMET_COLORS, VISOR_COLORS } from '../domain/helmet';
import '../scene-fallback.css';

/** Available even when the Three.js chunk or WebGL itself cannot load. */
export default function SceneFallback({ player, products }: { player: Player; products: Product[] }) {
  const selected = ['upper', 'head', 'accessory', 'keychain'].flatMap((slot) => {
    const product = products.find((item) => item.id === player.equipped[slot as keyof Player['equipped']]);
    return product ? [product] : [];
  });
  const bike = BIKES.find((item) => item.id === player.bike);
  return <fieldset className="scene-fallback" aria-label="Bildvorschau deines Setups">
    <div className="scene-fallback-heading"><strong>{bike?.name ?? 'Dein Motorrad'}</strong><span>Bildvorschau · 3D nicht verfügbar</span></div>
    {selected.length > 0 && <div className="scene-fallback-images">
      {selected.map((product) => {
        const color = product.preview?.colors.find((item) => item.variantIds.includes(player.variants[product.id]));
        const variant = product.variants.find((item) => item.id === player.variants[product.id]);
        const src = color?.front?.localImage || variant?.image || product.localImage || product.image;
        return <figure key={product.id}><img src={src} alt={`${product.title}${color ? ` · ${color.label}` : ''}`} /><figcaption>{product.title}{color && <span>{color.label}</span>}</figcaption></figure>;
      })}
    </div>}
    <div className="scene-fallback-colors">
      <span><i style={{ background: finishSwatch(player.paint) }} />Lack: {PAINTS.find((item) => item.value === player.paint)?.name ?? player.paint}</span>
      <span><i style={{ background: finishSwatch(player.rims) }} />Felgen: {RIMS.find((item) => item.value === player.rims)?.name ?? player.rims}</span>
      <span><i style={{ background: finishSwatch(player.helmetColor) }} />{HELMETS.find((item) => item.id === player.helmet)?.name}: {HELMET_COLORS.find((item) => item.value === player.helmetColor)?.name ?? player.helmetColor}</span>
      <span><i style={{ background: finishSwatch(player.helmetVisor) }} />Visier: {VISOR_COLORS.find((item) => item.value === player.helmetVisor)?.name ?? player.helmetVisor}</span>
    </div>
    <p>Die 3D-Vorschau ist gerade nicht verfügbar. Du kannst dein Setup weiter auswählen und ausrüsten.</p>
    <button className="button" type="button" onClick={() => window.location.reload()}>RELOAD</button>
  </fieldset>;
}
