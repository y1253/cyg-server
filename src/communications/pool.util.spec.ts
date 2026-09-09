import { pool } from './pool.util';

describe('pool', () => {
  it('keeps results index-aligned with the input', async () => {
    const out = await pool([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency ceiling', async () => {
    let inFlight = 0;
    let peak = 0;
    await pool(Array.from({ length: 20 }, (_, i) => i), 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i;
    });
    expect(peak).toBe(3);
  });

  it('does not spawn more workers than items', async () => {
    let started = 0;
    await pool([1, 2], 10, async (n) => {
      started++;
      return n;
    });
    expect(started).toBe(2);
  });

  it('handles an empty list without hanging', async () => {
    await expect(pool([], 5, async (n) => n)).resolves.toEqual([]);
  });

  it('propagates a rejection', async () => {
    await expect(
      pool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
