import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { uploadFileInChunks } from './graph.util';

/**
 * A chunked upload used to abort the entire send on the first bad response from
 * Graph — one 503 anywhere in a 250 MB push and every byte already transferred was
 * thrown away, surfacing as "Internal server error". The odds of that scale with the
 * number of chunks, which is why large attachments failed intermittently.
 *
 * Re-PUTting the same `Content-Range` is the resume Graph documents: it either has
 * those bytes or it does not, so a replay is idempotent by construction.
 */

/**
 * The arguments a mock was called with, typed.
 *
 * `jest.fn()` is `any`, so `mock.calls[0][0]` is an unchecked access the lint rules
 * reject. Mirrors `argsOf` in `internal-calls/internal-calls.service.spec.ts`.
 */
function argsOf<T extends unknown[]>(mock: jest.Mock, call = 0): T {
  return mock.mock.calls[call] as T;
}

describe('uploadFileInChunks — chunk resume', () => {
  let dir: string;
  let file: string;
  const BYTES = Buffer.from('hello upload');

  const res = (
    status: number,
    body = '',
    headers: Record<string, string> = {},
  ) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    }) as unknown as Response;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cyg-upload-'));
    file = path.join(dir, 'blob.bin');
    await writeFile(file, BYTES);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the parsed body when the first attempt succeeds', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(res(201, JSON.stringify({ id: 'item-1' })));

    await expect(
      uploadFileInChunks<{ id: string }>(
        'https://u',
        file,
        BYTES.length,
        'blob',
      ),
    ).resolves.toEqual({ id: 'item-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 502, 503])('retries a %s and succeeds', async (status) => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(res(status))
      .mockResolvedValueOnce(res(201, JSON.stringify({ id: 'item-2' })));

    await expect(
      uploadFileInChunks<{ id: string }>(
        'https://u',
        file,
        BYTES.length,
        'blob',
      ),
    ).resolves.toEqual({ id: 'item-2' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // The replay must name the SAME byte range, or Graph is being told about bytes it
  // never received and the file ends up corrupt.
  it('replays the identical Content-Range', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(201, '{}'));

    await uploadFileInChunks('https://u', file, BYTES.length, 'blob');

    const rangeOf = (i: number) => {
      const [, init] = argsOf<[string, { headers: Record<string, string> }]>(
        fetchMock as unknown as jest.Mock,
        i,
      );
      return init.headers['Content-Range'];
    };
    expect(rangeOf(0)).toBe(`bytes 0-${BYTES.length - 1}/${BYTES.length}`);
    expect(rangeOf(1)).toBe(rangeOf(0));
  });

  it('retries a dropped socket', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(
        Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      )
      .mockResolvedValueOnce(res(201, '{}'));

    await expect(
      uploadFileInChunks('https://u', file, BYTES.length, 'blob'),
    ).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A 4xx other than 429 is a genuine refusal. Retrying it wastes the user's time and
  // buries the real cause.
  it.each([400, 403, 404])('does NOT retry a %s', async (status) => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(res(status));

    await expect(
      uploadFileInChunks('https://u', file, BYTES.length, 'blob'),
    ).rejects.toThrow(`Upload failed for "blob" (${status})`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts and reports the last status', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(res(503));

    await expect(
      uploadFileInChunks('https://u', file, BYTES.length, 'blob'),
    ).rejects.toThrow('Upload failed for "blob" (503)');

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
