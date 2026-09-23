import { RealtimeService, visibleTo } from './realtime.service';

const ALICE = 1;
const BOB = 2;

describe('RealtimeService', () => {
  let svc: RealtimeService;

  beforeEach(() => {
    svc = new RealtimeService();
  });

  describe('the resume cursor', () => {
    it('answers a brand-new client at once, with no events and NO reset', async () => {
      svc.publish('call-ended', { companyId: 7 });

      const batch = await svc.wait(ALICE, 0);

      // A fresh mount has nothing stale: its queries were fetched moments ago. Replaying
      // a backlog at it, or forcing a resync, is pure waste on every page load.
      expect(batch.events).toEqual([]);
      expect(batch.reset).toBeUndefined();
      expect(batch.seq).toBe(1);
    });

    it('returns everything after the cursor, in order', async () => {
      svc.publish('call-ended', { companyId: 7 });
      svc.publish('sms', { companyId: 8 });

      // `since=0` skips the backlog and just hands over the cursor.
      const batch = await svc.wait(ALICE, 0);
      expect(batch.events).toEqual([]);
      svc.publish('whatsapp', { companyId: 9 });

      const next = await svc.wait(ALICE, batch.seq);
      expect(next.events.map((e) => e.topic)).toEqual(['whatsapp']);
      expect(next.seq).toBe(3);
    });

    it('parks when the cursor is current, rather than resyncing', async () => {
      svc.publish('phone', { companyId: 1 });
      const at = svc.cursor;

      let settled = false;
      const pending = svc.wait(ALICE, at, 50).then((b) => {
        settled = true;
        return b;
      });

      expect(settled).toBe(false);
      const batch = await pending;
      expect(batch.events).toEqual([]);
      expect(batch.reset).toBeUndefined();
    });

    it('resets when the cursor is ahead of the server (a restart)', async () => {
      svc.publish('phone', { companyId: 1 });

      const batch = await svc.wait(ALICE, 999);

      expect(batch.reset).toBe(true);
      expect(batch.seq).toBe(1);
    });

    it('resets when the events the client missed have been evicted', async () => {
      // Force a gap: drop the buffer's front while the counter keeps climbing.
      for (let i = 0; i < 600; i++) svc.publish('phone', { companyId: i });

      const batch = await svc.wait(ALICE, 1);

      expect(batch.reset).toBe(true);
    });
  });

  describe('waking a parked request', () => {
    it('resolves the instant a visible event is published', async () => {
      // cursor 0 on a server that has published nothing must PARK, not answer empty.
      const pending = svc.wait(ALICE, svc.cursor, 5_000);

      svc.publish('call-ended', { companyId: 42 });

      const batch = await pending;
      expect(batch.events).toHaveLength(1);
      expect(batch.events[0]).toMatchObject({ topic: 'call-ended', companyId: 42 });
    });

    it('leaves a request parked when the event is for somebody else', async () => {
      let settled = false;
      const pending = svc.wait(BOB, svc.cursor, 60).then((b) => {
        settled = true;
        return b;
      });

      svc.publish('internal-message', { userIds: [ALICE] });
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false);

      const batch = await pending;
      expect(batch.events).toEqual([]);
    });

    it('wakes several parked users from one broadcast', async () => {
      const a = svc.wait(ALICE, svc.cursor, 5_000);
      const b = svc.wait(BOB, svc.cursor, 5_000);
      expect(svc.waiterCount).toBe(2);

      svc.publish('presence');

      expect((await a).events).toHaveLength(1);
      expect((await b).events).toHaveLength(1);
      expect(svc.waiterCount).toBe(0);
    });
  });

  describe('the audience filter', () => {
    it('sends an event with no userIds to everybody', () => {
      expect(visibleTo({ seq: 1, at: 0, topic: 'sms', companyId: 3 }, ALICE)).toBe(true);
      expect(visibleTo({ seq: 1, at: 0, topic: 'sms', companyId: 3 }, BOB)).toBe(true);
    });

    it('sends a targeted event only to its targets', () => {
      const e = { seq: 1, at: 0, topic: 'internal-call' as const, userIds: [ALICE] };
      expect(visibleTo(e, ALICE)).toBe(true);
      expect(visibleTo(e, BOB)).toBe(false);
    });

    it('filters a batch, so a targeted event never reaches a bystander', async () => {
      svc.publish('presence'); // prime, so the cursor is past the brand-new-client path
      const start = svc.cursor;
      svc.publish('internal-message', { userIds: [ALICE] });
      svc.publish('sms', { companyId: 5 });

      const mine = await svc.wait(ALICE, start);
      const theirs = await svc.wait(BOB, start);

      expect(mine.events.map((e) => e.topic)).toEqual(['internal-message', 'sms']);
      expect(theirs.events.map((e) => e.topic)).toEqual(['sms']);
      // Both still advance to the same cursor: a filtered-out event must not strand a
      // bystander behind it, or every later poll would re-fetch the same gap.
      expect(theirs.seq).toBe(mine.seq);
    });
  });

  it('parks a first client on a silent server, instead of tight-looping', async () => {
    // `since=0` means "brand new". With a backlog it skips it and returns at once; with
    // NOTHING behind it, returning at once would hand back `seq: 0` to a client that
    // re-asks with `since=0` immediately -- a spin loop until the first event.
    let settled = false;
    const pending = svc.wait(ALICE, 0, 60).then((b) => {
      settled = true;
      return b;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    expect(svc.waiterCount).toBe(1);
    await pending;
  });

  it('delivers to a client parked from cursor zero', async () => {
    const pending = svc.wait(ALICE, 0, 5_000);
    svc.publish('sms', { companyId: 3 });

    const batch = await pending;
    expect(batch.events.map((e) => e.topic)).toEqual(['sms']);
  });

  it('never throws out of publish, whatever a caller passes', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => svc.publish('ringing', { payload: circular })).not.toThrow();
  });

  it('carries a payload through for the one topic that has one', async () => {
    svc.publish('presence'); // prime, so the cursor is past the brand-new-client path
    const start = svc.cursor;
    svc.publish('ringing', { companyId: 4, userIds: [ALICE], payload: { callSid: 'x' } });

    const batch = await svc.wait(ALICE, start);
    expect(batch.events[0].payload).toEqual({ callSid: 'x' });
  });
});
