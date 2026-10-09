import { expect, type Page } from '@playwright/test';
import type { Product } from '../../app/domain/types';
import { equipmentSlot } from '../../app/domain/preview';

export const primaryAction = (page: Page) => page.locator('.gc-primary');
export const chooseArea = (page: Page, name: 'Motorrad' | 'Fahrer') => page
  .getByRole('navigation', { name: 'Garage-Bereiche', exact: true })
  .getByRole('button', { name, exact: true }).click();
export const choosePart = (page: Page, name: string) => page
  .getByRole('navigation', { name: 'Ausrüstungsteil', exact: true })
  .getByRole('button', { name, exact: true }).click();
export const chooseBike = (page: Page, name: string) => page.locator('.gc-bike')
  .filter({ has: page.getByText(name, { exact: true }) }).click();
export const discardPreview = (page: Page) => page.locator('.gc-action')
  .getByRole('button', { name: 'Verwerfen', exact: true }).click();

export async function choosePaletteValue(page: Page, title: string, value: string) {
  const palette = page.getByRole('group', { name: title, exact: true });
  const option = palette.locator(`input[type="radio"][value="${value}"]`);
  if (!(await option.isVisible())) await palette.getByRole('button', { name: /Weitere Farben/ }).click();
  await option.check();
  await expect(option).toBeChecked();
}

export async function chooseProduct(page: Page, product: Product) {
  const slot = equipmentSlot(product);
  await chooseArea(page, slot === 'keychain' || slot === 'bike' ? 'Motorrad' : 'Fahrer');
  await choosePart(page, slot === 'keychain' || slot === 'bike' ? 'Extras'
    : slot === 'head' ? 'Kopf' : slot === 'upper' ? 'Oberteil' : 'Accessoires');
  if (slot === 'head') await page.getByRole('button', { name: 'Caps an der Hose', exact: true }).click();
  await page.getByTestId('product-card').filter({ has: page.getByText(product.title, { exact: true }) }).click();
}
