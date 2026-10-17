import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import catalog from '../public/catalog/products.json';
import type { Product } from '../app/domain/types';
import { firstColorImageView, productImage } from '../app/domain/preview';
import { newPlayer } from '../app/domain/progression';
import SceneFallback from '../app/ui/SceneFallback';

const product = {
  ...(catalog.find(item => item.preview?.colors.some(color => color.front && color.back)) as Product),
  image: 'https://shop.example/back.jpg',
  localImage: '/images/shop-first.jpg',
  images: ['https://shop.example/back.jpg', 'https://shop.example/front.jpg'],
  preview: { numberCustomization: false, colors: [{ id: 'black', label: 'Black', optionValue: 'Black',
    variantIds: ['black-variant'], baseColor: '#000000',
    front: { source: 'https://shop.example/front.jpg', localImage: '/images/front.jpg' },
    back: { source: 'https://shop.example/back.jpg', localImage: '/images/back.jpg' } }] },
} satisfies Product;

describe('original Shopify product photo order', () => {
  it('shows the first shop image by default even when an audited front photo exists', () => {
    expect(productImage(product)).toBe('/images/shop-first.jpg');
    expect(productImage(product, 'shop', 'black-variant')).toBe('/images/shop-first.jpg');
    expect(productImage({ ...product, localImage: undefined })).toBe(product.images[0]);
  });

  it('keeps explicit front/back controls and selects the earliest photo for a newly chosen color', () => {
    expect(productImage(product, 'front', 'black-variant')).toBe('/images/front.jpg');
    expect(productImage(product, 'back', 'black-variant')).toBe('/images/back.jpg');
    expect(firstColorImageView(product, 'black-variant')).toBe('back');
    expect(firstColorImageView({ ...product, images: [...product.images].reverse() }, 'black-variant')).toBe('front');
  });

  it('retains the original shop photo when no side mapping is published', () => {
    expect(productImage({ ...product, preview: undefined }, 'front')).toBe('/images/shop-first.jpg');
  });

  it('renders the first shop photo beside the rider fallback without forcing its front mapping', () => {
    const player = { ...newPlayer(), equipped: { upper: product.id }, variants: { [product.id]: 'black-variant' } };
    const html = renderToStaticMarkup(createElement(SceneFallback, { player, products: [product] }));
    expect(html).toContain('src="/images/shop-first.jpg"');
    expect(html).not.toContain('src="/images/front.jpg"');
  });
});
