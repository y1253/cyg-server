import type { ConfigService } from '@nestjs/config';
import { LuxandService } from './luxand.service.js';
import type { EnhancedPhoto, RawPhoto } from './face-image.js';

/**
 * These tests exist for one reason: to make the liveness rule fail loudly the day
 * somebody "simplifies" the photo path. The type system already makes passing an
 * EnhancedPhoto to `liveness()` a compile error; this proves the bytes are not
 * touched on the way out either.
 */

const config = {
  getOrThrow: () => 'test-key',
  get: () => undefined,
} as unknown as ConfigService;

/** Distinctive bytes, so "identical" cannot pass by accident. */
const FIXTURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0xfe]);

function mockFetch(body: unknown) {
  const calls: FormData[] = [];
  global.fetch = jest.fn(async (_url: unknown, init: any) => {
    calls.push(init.body as FormData);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

async function bytesOf(form: FormData, field: string): Promise<Buffer> {
  const blob = form.get(field) as Blob;
  return Buffer.from(await blob.arrayBuffer());
}

describe('LuxandService photo handling', () => {
  let service: LuxandService;

  beforeEach(() => {
    service = new LuxandService(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the liveness photo byte-for-byte as received', async () => {
    const calls = mockFetch({ status: 'success', score: 0.9 });
    const raw: RawPhoto = { buffer: FIXTURE, mimeType: 'image/jpeg' };

    await service.liveness(raw);

    expect(await bytesOf(calls[0], 'photo')).toEqual(FIXTURE);
  });

  it('sends the verify photo exactly as handed over, without re-processing it', async () => {
    const calls = mockFetch({ status: 'success', probability: 0.88 });
    const enhanced = {
      buffer: FIXTURE,
      mimeType: 'image/jpeg',
    } as EnhancedPhoto;

    await service.verify('person-uuid', enhanced);

    // LuxandService no longer owns any image policy: what the caller enhanced is
    // what Luxand receives. The `normalize` flag that used to live here is what
    // made the liveness rule one flipped boolean from failing silently.
    expect(await bytesOf(calls[0], 'photo')).toEqual(FIXTURE);
  });

  it('appends enrolment photos under the repeatable plural field', async () => {
    const calls = mockFetch({ status: 'success', uuid: 'abc' });
    const photos = [1, 2, 3].map(
      (n) =>
        ({ buffer: Buffer.from([n]), mimeType: 'image/jpeg' }) as EnhancedPhoto,
    );

    await service.createPerson('Someone (#1)', photos);

    // `photo` singular here returns a bare HTTP 500 from Luxand.
    expect(calls[0].getAll('photos')).toHaveLength(3);
    expect(calls[0].getAll('photo')).toHaveLength(0);
  });
});
