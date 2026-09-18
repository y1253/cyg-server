import {
  matchTemplate,
  reconcileSubmission,
  reconcileSubmissions,
  type LiveTemplate,
  type StoredSubmission,
} from './whatsapp-template-status.util';

function row(over: Partial<StoredSubmission> = {}): StoredSubmission {
  return {
    id: 1,
    metaTemplateId: null,
    name: 'order_update',
    language: 'en_US',
    status: 'PENDING',
    rejectedReason: null,
    ...over,
  };
}

function live(over: Partial<LiveTemplate> = {}): LiveTemplate {
  return {
    id: '555',
    name: 'order_update',
    language: 'en_US',
    status: 'APPROVED',
    rejectedReason: null,
    ...over,
  };
}

describe('matchTemplate', () => {
  it('prefers Meta id, which survives everything else changing', () => {
    const found = matchTemplate(row({ metaTemplateId: '555', name: 'stale' }), [
      live({ id: '555', name: 'renamed' }),
    ]);
    expect(found?.id).toBe('555');
  });

  it('falls back to name+language, the pair Meta itself keys on', () => {
    const found = matchTemplate(row(), [live({ id: null })]);
    expect(found).not.toBeNull();
  });

  it('does not match the same name in another language', () => {
    expect(matchTemplate(row(), [live({ language: 'fr' })])).toBeNull();
  });

  it('falls back to name+language when the stored id is not in the list', () => {
    // A row whose id we hold but which Meta now lists under a new id still matches.
    const found = matchTemplate(row({ metaTemplateId: 'gone' }), [live()]);
    expect(found?.id).toBe('555');
  });
});

describe('reconcileSubmission', () => {
  it('takes Meta status as truth', () => {
    expect(reconcileSubmission(row(), [live()])).toEqual({
      id: 1,
      status: 'APPROVED',
      rejectedReason: null,
    });
  });

  it('carries the rejection reason across', () => {
    expect(
      reconcileSubmission(row(), [
        live({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' }),
      ]),
    ).toEqual({ id: 1, status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' });
  });

  it('⚠️ lets a REJECTED template go back to PENDING and then APPROVED', () => {
    // The case a monotonic ladder like `nextDeliveryStatus` would break. After an edit
    // Meta re-reviews, and a forward-only rule would pin the row at REJECTED for ever --
    // the repair would silently appear to do nothing.
    const rejected = row({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' });
    expect(reconcileSubmission(rejected, [live({ status: 'PENDING' })])).toEqual({
      id: 1,
      status: 'PENDING',
      rejectedReason: null,
    });
    const pending = row({ status: 'PENDING' });
    expect(reconcileSubmission(pending, [live({ status: 'APPROVED' })])).toEqual({
      id: 1,
      status: 'APPROVED',
      rejectedReason: null,
    });
  });

  it('writes nothing when nothing moved', () => {
    expect(
      reconcileSubmission(row({ status: 'APPROVED' }), [live()]),
    ).toBeNull();
  });

  it('writes when only the reason changed', () => {
    const r = row({ status: 'REJECTED', rejectedReason: null });
    expect(
      reconcileSubmission(r, [live({ status: 'REJECTED', rejectedReason: 'SCAM' })]),
    ).toEqual({ id: 1, status: 'REJECTED', rejectedReason: 'SCAM' });
  });

  it('leaves an unmatched row ALONE rather than guessing', () => {
    // `listTemplates` returns [] on any Graph failure, and a token without
    // whatsapp_business_management sees nothing. Neither means "it was deleted".
    expect(reconcileSubmission(row(), [])).toBeNull();
    expect(reconcileSubmission(row(), [live({ name: 'someone_elses' })])).toBeNull();
  });
});

describe('reconcileSubmissions', () => {
  it('returns only the rows that moved', () => {
    const patches = reconcileSubmissions(
      [
        row({ id: 1, name: 'moved' }),
        row({ id: 2, name: 'settled', status: 'APPROVED' }),
        row({ id: 3, name: 'unknown' }),
      ],
      [live({ name: 'moved' }), live({ name: 'settled' })],
    );
    expect(patches).toEqual([{ id: 1, status: 'APPROVED', rejectedReason: null }]);
  });

  it('is empty for an empty live list, whatever is stored', () => {
    expect(reconcileSubmissions([row(), row({ id: 2 })], [])).toEqual([]);
  });
});
