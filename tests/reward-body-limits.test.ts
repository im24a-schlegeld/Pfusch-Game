import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readBoundedJson, readBoundedWebJson, type NodeRequest } from '../server/shopify/http';
import { MAX_BODY_BYTES } from '../server/shopify/playerValidation';
import { MAX_REWARD_FINISH_BODY_BYTES } from '../server/shopify/rewardEndpoint';

const node = (body: string, advertised?: number): NodeRequest => Object.assign(Readable.from([
  Buffer.from(body.slice(0, 80000)), Buffer.from(body.slice(80000)),
]), { headers: advertised === undefined ? {} : { 'content-length': String(advertised) } });
const worker = (body: string, advertised?: number) => new Request('https://game.example/api/rewards/run/finish', {
  method: 'POST', body, headers: advertised === undefined ? {} : { 'content-length': String(advertised) },
});

describe('separate verified proof request limit', () => {
  it('accepts full-precision mobile proofs above 128 KiB while retaining the default player limit', async () => {
    const value = { csrfToken: 'c'.repeat(100), token: 't'.repeat(500), proof: { ticks: 18000,
      events: Array.from({ length: 2000 }, (_, tick) => ({ tick: tick * 6,
        input: { type: 'weight', value: 0.12345678901234568 } })) } };
    const body = JSON.stringify(value);
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_BODY_BYTES);
    expect(Buffer.byteLength(body)).toBeLessThan(MAX_REWARD_FINISH_BODY_BYTES);
    await expect(readBoundedJson(node(body))).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedWebJson(worker(body))).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedJson(node(body), MAX_REWARD_FINISH_BODY_BYTES)).resolves.toEqual(value);
    await expect(readBoundedWebJson(worker(body), MAX_REWARD_FINISH_BODY_BYTES)).resolves.toEqual(value);
    await expect(readBoundedJson(Object.assign(node(''), { body: value }), MAX_REWARD_FINISH_BODY_BYTES)).resolves.toEqual(value);
  });

  it('enforces 262144 bytes on streamed, parsed and advertised bodies', async () => {
    const atLimit = `"${'a'.repeat(MAX_REWARD_FINISH_BODY_BYTES - 2)}"`;
    await expect(readBoundedJson(node(atLimit), MAX_REWARD_FINISH_BODY_BYTES)).resolves.toHaveLength(MAX_REWARD_FINISH_BODY_BYTES - 2);
    await expect(readBoundedWebJson(worker(atLimit), MAX_REWARD_FINISH_BODY_BYTES)).resolves.toHaveLength(MAX_REWARD_FINISH_BODY_BYTES - 2);
    const tooLarge = `"${'a'.repeat(MAX_REWARD_FINISH_BODY_BYTES - 1)}"`;
    await expect(readBoundedJson(node(tooLarge), MAX_REWARD_FINISH_BODY_BYTES)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedJson(Object.assign(node(''), { body: { padding: 'a'.repeat(MAX_REWARD_FINISH_BODY_BYTES) } }), MAX_REWARD_FINISH_BODY_BYTES)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedWebJson(worker(tooLarge), MAX_REWARD_FINISH_BODY_BYTES)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedJson(node('{}', MAX_REWARD_FINISH_BODY_BYTES + 1), MAX_REWARD_FINISH_BODY_BYTES)).rejects.toMatchObject({ status: 413 });
    await expect(readBoundedWebJson(worker('{}', MAX_REWARD_FINISH_BODY_BYTES + 1), MAX_REWARD_FINISH_BODY_BYTES)).rejects.toMatchObject({ status: 413 });
  });
});
