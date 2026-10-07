import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Public, read-only Shopify source. Never uses Admin credentials or edits the shop.
const root = fileURLToPath(new URL('../', import.meta.url));
const shop = 'https://pfusch-clothing.ch';
const day = new Date().toISOString().slice(0, 10);
const evidence = resolve(root, `outputs/catalog-refresh-${day}`);
await mkdir(evidence, { recursive: true });
const old = JSON.parse(await readFile(resolve(root, 'public/catalog/products.json'), 'utf8'));
const overrides = JSON.parse(await readFile(resolve(root, 'public/catalog/product-overrides.json'), 'utf8'));
const previous = new Map(old.map(product => [product.id, product]));
async function get(url, name) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const value = await response.text();
  await writeFile(resolve(evidence, name), value);
  return value;
}
const source = [];
const pages = [];
for (let page = 1; page <= 100; page++) {
  const url = `${shop}/products.json?limit=250&page=${page}`;
  const products = JSON.parse(await get(url, `products-page-${page}.json`)).products;
  if (!Array.isArray(products)) throw new Error(`Invalid products page ${page}`);
  pages.push({ url, count: products.length });
  source.push(...products);
  if (!products.length) break;
  if (page === 100) throw new Error('Pagination was not exhausted');
}
const xmlLocations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].replaceAll('&amp;', '&'));
const sitemapIndex = await get(`${shop}/sitemap.xml`, 'sitemap.xml');
const productSitemaps = xmlLocations(sitemapIndex).filter(url => /\/sitemap_products_\d+\.xml/.test(url));
if (!productSitemaps.length) throw new Error('No product sitemaps found');
const sitemapResults = [];
// Every localized product sitemap is checked, not just the first/default language.
for (let i = 0; i < productSitemaps.length; i++) {
  const url = productSitemaps[i];
  if (new URL(url).origin !== shop) throw new Error('Unexpected sitemap origin');
  const xml = await get(url, `sitemap-products-${i + 1}.xml`);
  const handles = [...new Set(xmlLocations(xml).flatMap(location => {
    const match = new URL(location).pathname.match(/\/products\/([^/]+)\/?$/);
    return match ? [decodeURIComponent(match[1])] : [];
  }))].sort();
  sitemapResults.push({ url, handles });
}
const sitemapHandles = [...new Set(sitemapResults.flatMap(sitemap => sitemap.handles))].sort();
for (const handle of sitemapHandles) {
  if (!source.some(product => product.handle === handle)) {
    const json = JSON.parse(await get(`${shop}/products/${encodeURIComponent(handle)}.json`, `product-${handle}.json`));
    if (!json.product) throw new Error(`Sitemap product missing: ${handle}`);
    source.push(json.product);
  }
}
if (new Set(source.map(product => String(product.id))).size !== source.length) throw new Error('Duplicate source product IDs');
const stripHtml = html => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function infer(product) {
  const name = `${product.title} ${product.handle}`.toLowerCase();
  if (/flag/.test(name)) return { type: 'Flag', category: 'collectible' };
  if (/sticker/.test(name)) return { type: 'Sticker', category: 'collectible' };
  if (/cap/.test(name)) return { type: 'Cap', category: 'head' };
  if (/schl[uü]ssel|keychain/.test(name)) return { type: 'Keychain', category: 'accessory' };
  if (/tasche|bag/.test(name)) return { type: 'Bag', category: 'accessory' };
  if (/t-shirt|shirt/.test(name)) return { type: 'T-Shirt', category: 'upper' };
  if (/hoodie|zipper|windbreaker/.test(name)) return { type: 'Outerwear', category: 'upper' };
  return { type: product.product_type || 'Collectible', category: 'collectible' };
}
const catalog = source.map(product => {
  const id = String(product.id), prior = previous.get(id), override = overrides[id] ?? {};
  const images = product.images.map(image => image.src);
  const image = images[0] ?? '';
  const baseColor = override.baseColor ?? prior?.baseColor ?? '#323232';
  if (override.preview?.artwork && !images.includes(override.preview.artwork.source)) {
    throw new Error(`Artwork changed for ${product.handle}; review source and UV crop before updating its override`);
  }
  const extension = new URL(image).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'jpg';
  const localImage = prior?.image === image && prior.localImage && existsSync(resolve(root, 'public', prior.localImage))
    ? prior.localImage : `images/${product.handle}.${extension}`;
  const variants = product.variants.map(variant => {
    const known = prior?.variants.find(item => item.id === String(variant.id));
    return { id: String(variant.id), title: variant.title, available: variant.available,
      price: Number(variant.price), options: [variant.option1, variant.option2, variant.option3].filter(value => value != null),
      image: variant.featured_image?.src ?? image, baseColor: known?.baseColor ?? baseColor };
  });
  // Audited front/back mappings remain valid only while those exact source images remain published.
  const preview = override.preview ?? (prior?.preview ? { ...prior.preview, colors: prior.preview.colors.map(color => ({
    ...color, variantIds: color.variantIds.filter(id => variants.some(variant => variant.id === id)),
    front: color.front && images.includes(color.front.source) ? color.front : null,
    back: color.back && images.includes(color.back.source) ? color.back : null,
  })) } : undefined);
  return { ...prior, ...infer(product), ...override, id, title: product.title, handle: product.handle,
    url: `${shop}/products/${product.handle}`, price: Math.min(...variants.map(variant => variant.price)), currency: 'CHF',
    images, image, localImage, shopifyProductType: product.product_type,
    category: override.category ?? prior?.category ?? infer(product).category,
    type: override.type ?? prior?.type ?? infer(product).type, baseColor,
    description: override.description ?? prior?.description ?? stripHtml(product.body_html),
    options: product.options.map(option => ({ name: option.name, values: option.values })), variants,
    available: variants.some(variant => variant.available), tags: product.tags, publishedAt: product.published_at,
    sourceUpdatedAt: product.updated_at, sourceDescription: stripHtml(product.body_html), sourceDescriptionHtml: product.body_html,
    sourceStatus: 'published', ...(preview ? { preview } : {}) };
});
const ids = new Set(catalog.map(product => product.id));
// A removed listing keeps its stable identity and historical ownership, never aliases a replacement ID.
for (const product of old) if (!ids.has(product.id)) catalog.push({ ...product, sourceStatus: 'retired', available: false,
  variants: product.variants.map(variant => ({ ...variant, available: false })) });
await mkdir(resolve(root, 'public/images/catalog-source'), { recursive: true });
let imageDownloads = 0;
for (const product of catalog.filter(product => product.sourceStatus === 'published')) {
  const prior = previous.get(product.id);
  const files = [];
  if (!prior || prior.image !== product.image || !existsSync(resolve(root, 'public', product.localImage))) {
    const rendition = new URL(product.image); rendition.searchParams.set('width', '640');
    files.push({ url: rendition.href, path: product.localImage });
  }
  const artwork = product.preview?.artwork;
  if (artwork) files.push({ url: artwork.source, path: artwork.localImage.replace(/^\//, '') });
  for (const file of files) {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Invalid image: ${file.url}`);
    await writeFile(resolve(root, 'public', file.path), Buffer.from(await response.arrayBuffer()));
    imageDownloads++;
  }
}
const published = catalog.filter(product => product.sourceStatus === 'published');
const coverage = { fetchedAt: new Date().toISOString(), shop, pages, paginationExhausted: pages.at(-1).count === 0,
  productSitemaps: sitemapResults, publishedProductIds: published.map(product => product.id),
  retiredProductIds: catalog.filter(product => product.sourceStatus === 'retired').map(product => product.id),
  sitemapHandles, missingSitemapHandles: sitemapHandles.filter(handle => !published.some(product => product.handle === handle)),
  publishedProducts: published.length, publishedVariants: published.reduce((sum, product) => sum + product.variants.length, 0),
  sourceImages: published.reduce((sum, product) => sum + product.images.length, 0), imageDownloads };
if (coverage.missingSitemapHandles.length) throw new Error('Incomplete sitemap coverage');
await writeFile(resolve(root, 'public/catalog/products.json'), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(resolve(root, 'public/catalog/coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
console.log(JSON.stringify({ ...coverage, productSitemaps: productSitemaps.length, sitemapHandles: sitemapHandles.length }, null, 2));
