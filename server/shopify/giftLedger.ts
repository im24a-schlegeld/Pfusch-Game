import { ApiError } from './auth.js';
import { byteLength } from './crypto.js';
import { isRecord, MAX_BODY_BYTES } from './playerValidation.js';

export const GIFT_KEY = 'gifts_v1';
export const MAX_GIFT_HISTORY = 500;
export const MAX_PENDING_GIFTS = 20;
export interface GiftNotification {
  id: string;
  kind: 'coins' | 'guardianBells';
  amount: number;
  message: string;
  sentAt: string;
}
export interface GiftEntry extends GiftNotification { actor: string; acknowledged: boolean }
export interface GiftLedger { version: 1; entries: GiftEntry[] }
export interface SavedGifts { ledger: GiftLedger; compareDigest: string | null }
export const validGiftId = (value: unknown): value is string => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const validGiftDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const validMessage = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 &&
  !value.split('').some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function parseGiftInput(value: unknown): Pick<GiftNotification, 'id' | 'kind' | 'amount' | 'message'> {
  if (!isRecord(value) || Object.keys(value).some(key => !['id', 'kind', 'amount', 'message'].includes(key)))
    throw new ApiError(400, 'invalid_gift');
  const id = typeof value.id === 'string' ? value.id.toLowerCase() : value.id;
  const message = value.message === undefined ? '' : value.message;
  if (!validGiftId(id) || (value.kind !== 'coins' && value.kind !== 'guardianBells') ||
    typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1 ||
    value.amount > (value.kind === 'coins' ? 2000 : 5) || !validMessage(message))
    throw new ApiError(400, 'invalid_gift');
  return { id, kind: value.kind as GiftNotification['kind'], amount: value.amount, message };
}

/** Missing v1 ledger migrates to empty; malformed receipts never become empty. */
export function readGiftLedger(field: unknown): SavedGifts {
  if (field === null || field === undefined) return { ledger: { version: 1, entries: [] }, compareDigest: null };
  if (!isRecord(field) || typeof field.value !== 'string' || byteLength(field.value) > MAX_BODY_BYTES || !validGiftDigest(field.compareDigest))
    throw new ApiError(502, 'invalid_gift_ledger');
  try {
    const data: unknown = JSON.parse(field.value);
    if (!isRecord(data) || data.version !== 1 || Object.keys(data).length !== 2 || !Array.isArray(data.entries) || data.entries.length > MAX_GIFT_HISTORY)
      throw new Error();
    const ids = new Set<string>();
    const entries = data.entries.map((entry): GiftEntry => {
      if (!isRecord(entry) || Object.keys(entry).length !== 7 || !validGiftId(entry.id) || ids.has(entry.id) ||
        typeof entry.actor !== 'string' || !/^[1-9]\d{0,19}$/.test(entry.actor) || typeof entry.acknowledged !== 'boolean' ||
        typeof entry.sentAt !== 'string' || !Number.isFinite(Date.parse(entry.sentAt)) || new Date(entry.sentAt).toISOString() !== entry.sentAt)
        throw new Error();
      const input = parseGiftInput({ id: entry.id, kind: entry.kind, amount: entry.amount, message: entry.message });
      ids.add(input.id);
      return { ...input, sentAt: entry.sentAt, actor: entry.actor, acknowledged: entry.acknowledged };
    });
    return { ledger: { version: 1, entries }, compareDigest: field.compareDigest };
  } catch { throw new ApiError(502, 'invalid_gift_ledger'); }
}

export const publicGift = ({ id, kind, amount, message, sentAt }: GiftNotification): GiftNotification => ({ id, kind, amount, message, sentAt });
export const pendingGifts = (ledger: GiftLedger): GiftNotification[] => ledger.entries.filter(entry => !entry.acknowledged)
  .slice(0, MAX_PENDING_GIFTS).map(publicGift);
