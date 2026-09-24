import {
  MS_BASE_SCOPES,
  MS_TEAMS_SCOPES,
  refreshScopesFor,
  scopesFor,
} from './msal.util';

/**
 * The scope lists are the one part of the Microsoft integration that has to agree with
 * something OUTSIDE this repo — the Azure app registration's consented permissions — and
 * a disagreement fails at consent time for a customer, not in CI. So they are pinned by
 * name rather than by shape.
 */
describe('scopesFor', () => {
  it('asks for exactly the five consented resource scopes on a work connect', () => {
    expect(scopesFor('work')).toEqual([
      'Mail.ReadWrite',
      'Mail.Send',
      'User.Read',
      'Files.ReadWrite',
      'Chat.ReadWrite',
    ]);
  });

  it('does NOT ask for ChatMessage.Send', () => {
    // ⚠️ Requested from day one and never declared on the app registration, so the
    // requested set and the consented set disagreed for months. It is redundant —
    // `Chat.ReadWrite` already authorises POST /me/chats/{id}/messages, the only send we
    // make — so it was removed rather than added in Azure. A tenant with user consent
    // disabled would have refused the whole authorize request over it.
    expect(scopesFor('work')).not.toContain('ChatMessage.Send');
    expect(MS_TEAMS_SCOPES).not.toContain('ChatMessage.Send');
  });

  it('leaves Teams scopes out of a personal connect', () => {
    // Personal Microsoft accounts have no Graph Chat API at all, and asking breaks consent.
    expect(scopesFor('personal')).toEqual(MS_BASE_SCOPES);
    expect(scopesFor('personal')).not.toContain('Chat.ReadWrite');
  });

  it('never returns a reserved OIDC scope', () => {
    // MSAL appends these itself and throws ClientConfigurationError if handed them.
    for (const kind of ['work', 'personal'] as const) {
      for (const reserved of ['openid', 'profile', 'email', 'offline_access']) {
        expect(scopesFor(kind)).not.toContain(reserved);
      }
    }
  });
});

describe('refreshScopesFor', () => {
  it('does NOT ask for a scope the account was never granted', () => {
    // ⚠️ THE BUG THIS EXISTS FOR. `Files.ReadWrite` was added to MS_BASE_SCOPES on 30 Jul;
    // an account connected on 22 Jul never had it. Microsoft does not widen an existing
    // token, so asking failed the ENTIRE refresh with AADSTS70000 — 1609 times on one
    // company, once a minute, until this stopped inferring and started reading.
    const granted =
      'Chat.ReadWrite ChatMessage.Send Mail.ReadWrite Mail.Send openid profile User.Read email';

    const scopes = refreshScopesFor(granted);

    expect(scopes).not.toContain('Files.ReadWrite');
    expect(scopes).toEqual([
      'Mail.ReadWrite',
      'Mail.Send',
      'User.Read',
      'Chat.ReadWrite',
    ]);
  });

  it('asks for everything a full work grant carries', () => {
    const granted =
      'Chat.ReadWrite ChatMessage.Send Mail.ReadWrite Mail.Send openid profile User.Read email Files.ReadWrite';

    expect(refreshScopesFor(granted)).toEqual(scopesFor('work'));
  });

  it('keeps a personal account off the Teams scopes', () => {
    const granted = 'Mail.ReadWrite Mail.Send User.Read openid profile email';

    expect(refreshScopesFor(granted)).not.toContain('Chat.ReadWrite');
  });

  it('drops a granted scope the code no longer wants', () => {
    // Asking for a SUBSET of the grant is always safe, which is what makes removing
    // ChatMessage.Send a no-op for the accounts that already have it — no reconnect.
    const granted = 'ChatMessage.Send Mail.ReadWrite Mail.Send User.Read';

    expect(refreshScopesFor(granted)).not.toContain('ChatMessage.Send');
    expect(refreshScopesFor(granted)).toContain('Mail.ReadWrite');
  });

  it('never returns a reserved OIDC scope, however the grant spells it', () => {
    const granted = 'openid profile email offline_access Mail.Send';

    expect(refreshScopesFor(granted)).toEqual(['Mail.Send']);
  });

  it('matches case-insensitively', () => {
    // Microsoft echoes the list in its own casing; what we SEND must be our spelling.
    expect(refreshScopesFor('mail.readwrite MAIL.SEND user.read')).toEqual([
      'Mail.ReadWrite',
      'Mail.Send',
      'User.Read',
    ]);
  });

  it('falls back to the base scopes rather than asking for nothing', () => {
    // An old row, or a scope string we failed to store. A token good for nothing is
    // worse than one good for mail.
    expect(refreshScopesFor(null)).toEqual(MS_BASE_SCOPES);
    expect(refreshScopesFor('')).toEqual(MS_BASE_SCOPES);
    expect(refreshScopesFor('openid profile')).toEqual(MS_BASE_SCOPES);
  });
});
