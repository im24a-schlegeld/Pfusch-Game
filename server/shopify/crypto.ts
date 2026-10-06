/** Web-standard primitives shared by Node previews and Shopify Oxygen workers. */
const encoder = new TextEncoder();
export const utf8 = (value: string) => encoder.encode(value);
export const byteLength = (value: string) => utf8(value).byteLength;
export const hex = (value: ArrayBuffer | Uint8Array) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (value: string) => hex(await crypto.subtle.digest('SHA-256', utf8(value)));
const hmacKey = (secret: string, usage: KeyUsage) => crypto.subtle.importKey('raw', utf8(secret),
  { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
export async function hmacSha256(value: string, secret: string) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), utf8(value)));
}
export async function verifyHmacHex(actual: string, value: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const signature = Uint8Array.from(actual.match(/../g)!, pair => Number.parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), signature, utf8(value));
}
