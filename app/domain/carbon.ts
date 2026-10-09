/** A single premium finish; existing appearance strings and inventory IDs retain schema v1. */
export const DARK_CARBON = 'carbon-dark';
export const CARBON_PRICE = 1_000;
export const CARBON_PAINT_PRICE = 3_000;
export const CARBON_RIM_PRICE = 500;
export const CARBON_FINISH = { name: 'Dunkles Karbon · Premium', value: DARK_CARBON, price: CARBON_PRICE };
export const CARBON_TEXTURE = '/textures/carbon-dark.jpg';
export const finishBaseColor = (value: string) => value === DARK_CARBON ? '#24282b' : value;
export const finishSwatch = (value: string) => value === DARK_CARBON ? `#202224 url(${CARBON_TEXTURE}) center / 64px` : value;
