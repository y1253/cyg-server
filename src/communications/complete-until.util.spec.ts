import { idsUpTo } from './complete-until.util';

const m = (id: string, at: string) => ({ id, at });

describe('idsUpTo', () => {
  const thread = [
    m('a', '2026-09-17T09:00:00.000Z'),
    m('b', '2026-09-17T09:05:00.000Z'),
    m('c', '2026-09-17T09:30:00.000Z'),
  ];

  it('takes the anchor and everything older', () => {
    expect(idsUpTo(thread, 'b')).toEqual(['a', 'b']);
  });

  it('takes the whole conversation when the anchor is the newest', () => {
    expect(idsUpTo(thread, 'c')).toEqual(['a', 'b', 'c']);
  });

  it('takes only the anchor when it is the oldest', () => {
    expect(idsUpTo(thread, 'a')).toEqual(['a']);
  });

  /**
   * The views disagree about direction — the SMS thread reads oldest-first, a chat page
   * arrives newest-first — so the answer must not depend on how the caller held the list.
   */
  it('gives the same answer whatever order the caller passes', () => {
    expect(idsUpTo([...thread].reverse(), 'b')).toEqual(['a', 'b']);
  });

  /**
   * ⚠️ WhatsApp timestamps come off Meta in whole SECONDS, so a burst shares one `at`.
   * Without the id tie-break the anchor's position among its neighbours is undefined.
   */
  it('is stable when several messages share a timestamp', () => {
    const burst = [
      m('w1', '2026-09-17T09:00:00.000Z'),
      m('w2', '2026-09-17T09:00:00.000Z'),
      m('w3', '2026-09-17T09:00:00.000Z'),
    ];
    expect(idsUpTo(burst, 'w2')).toEqual(['w1', 'w2']);
    expect(idsUpTo([...burst].reverse(), 'w2')).toEqual(['w1', 'w2']);
  });

  /**
   * ⚠️ The case that must never become "complete everything". The client's thread view is
   * capped, so an anchor the server's rebuild does not contain is a real possibility.
   */
  it('refuses when the anchor is not in the conversation', () => {
    expect(idsUpTo(thread, 'gone')).toBeNull();
    expect(idsUpTo([], 'a')).toBeNull();
  });

  it('puts an unparseable timestamp at the start, where it can only be swept up', () => {
    const odd = [m('bad', 'not-a-date'), ...thread];
    expect(idsUpTo(odd, 'a')).toEqual(['bad', 'a']);
    expect(idsUpTo(odd, 'bad')).toEqual(['bad']);
  });
});
