import { GmailService } from './gmail.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The sender-name diagnosis surfaced to the Communications tab as a banner.
 *
 * The error payloads below are the REAL ones Google returned in production — copied from
 * the PM2 logs — because the first version of this feature was wrong precisely by
 * guessing at them: it read `PERMISSION_DENIED` as a bad grant and told the user to
 * reconnect, which for a consumer account can never work.
 */
describe('chat sender diagnosis', () => {
  // Reaches the private diagnosis internals; they're deliberately not public API.
  type Internals = {
    notePeopleFailure: (
      companyId: number,
      where: string,
      err: unknown,
      scopeOk: boolean,
    ) => void;
    notePeopleSuccess: (companyId: number) => void;
    clearSenderState: (companyId: number) => void;
    missTtl: (companyId: number) => number;
    diagnoseSenderNames: (
      companyId: number,
      unknownCount: number,
    ) => string | null;
  };

  let svc: Internals;
  let warn: jest.SpyInstance;

  const COMPANY = 42;

  // Shaped like a googleapis GaxiosError, which nests the real status under response.data.
  const gaxios = (status: string, message: string) => ({
    code: 403,
    message,
    response: { data: { error: { status, message } } },
  });

  // Google's answer to listDirectoryPeople for a personal @gmail.com — there is no domain.
  const NO_DOMAIN = gaxios('FAILED_PRECONDITION', 'Must be a G Suite domain user.');
  // Also seen on consumer accounts, *despite* directory.readonly having been granted.
  const INSUFFICIENT = gaxios(
    'PERMISSION_DENIED',
    'Request had insufficient authentication scopes.',
  );
  const SERVICE_OFF = gaxios(
    'SERVICE_DISABLED',
    'People API has not been used in project 123 before or it is disabled.',
  );

  beforeEach(() => {
    svc = new GmailService({} as PrismaService) as unknown as Internals;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  describe('the banner is gated on the observed symptom, not a prediction', () => {
    it('stays silent when no sender is Unknown, even though People failed', () => {
      svc.notePeopleFailure(COMPANY, 'listDirectoryPeople', SERVICE_OFF, true);
      // Names came from spaces.members.list, which needs no People API.
      expect(svc.diagnoseSenderNames(COMPANY, 0)).toBeNull();
    });

    it('reports only once a sender actually resolved to Unknown', () => {
      svc.notePeopleFailure(COMPANY, 'listDirectoryPeople', SERVICE_OFF, true);
      expect(svc.diagnoseSenderNames(COMPANY, 1)).toBe('api_disabled');
    });
  });

  describe('classification of real Google failures', () => {
    it('calls a personal account undisclosed, not a bad grant', () => {
      // The exact case behind the bogus "reconnect the account" advice.
      svc.notePeopleFailure(COMPANY, 'listDirectoryPeople', NO_DOMAIN, true);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('undisclosed');
    });

    it('treats a denied-but-granted directory scope as undisclosed', () => {
      svc.notePeopleFailure(COMPANY, 'listDirectoryPeople', INSUFFICIENT, true);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('undisclosed');
    });

    it('blames the grant only when the grant genuinely lacks People scopes', () => {
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', INSUFFICIENT, false);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('scopes');
    });

    it('blames the API only on SERVICE_DISABLED, whatever the grant', () => {
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', SERVICE_OFF, true);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('api_disabled');
    });
  });

  describe('self-healing (the service is a long-lived singleton)', () => {
    it('clears a fixable fault once a People call succeeds', () => {
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', SERVICE_OFF, true);
      svc.notePeopleSuccess(COMPANY);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('undisclosed');
    });

    it('clears a stale fault on reconnect', () => {
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', INSUFFICIENT, false);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('scopes');
      svc.clearSenderState(COMPANY);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('undisclosed');
    });

    it('downgrades a fault when a later call proves it is really undisclosed', () => {
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', SERVICE_OFF, true);
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', NO_DOMAIN, true);
      expect(svc.diagnoseSenderNames(COMPANY, 3)).toBe('undisclosed');
    });

    it('re-probes People sooner while a fixable fault is on record', () => {
      const healthy = svc.missTtl(COMPANY);
      svc.notePeopleFailure(COMPANY, 'people.getBatchGet', SERVICE_OFF, true);
      expect(svc.missTtl(COMPANY)).toBeLessThan(healthy);
    });
  });

  it('keeps companies independent', () => {
    svc.notePeopleFailure(COMPANY, 'people.getBatchGet', SERVICE_OFF, true);
    expect(svc.diagnoseSenderNames(99, 3)).toBe('undisclosed');
  });

  it('logs Google real error once per company', () => {
    svc.notePeopleFailure(COMPANY, 'listDirectoryPeople', NO_DOMAIN, true);
    svc.notePeopleFailure(COMPANY, 'listDirectoryPeople', NO_DOMAIN, true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Must be a G Suite domain user');
  });
});
