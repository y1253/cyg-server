import { MicrosoftController } from './microsoft.controller';
import type { MicrosoftService } from './microsoft.service';

/**
 * The OAuth callback's `error` branch.
 *
 * Azure redirects here with NO `code` when consent is refused or dismissed, carrying the
 * only text that says why. The handler used to take `code` and `state` alone, feed
 * `undefined` into MSAL, report whatever MSAL said about the missing code, and log
 * nothing — so a failed connect left no trace on the server at all, and the AADSTS text
 * was discarded every time. Company 49 failed twice in one afternoon with
 * `access_denied` / `cancel` and neither attempt appears anywhere in the logs.
 */
describe('MicrosoftController.callback', () => {
  const FRONTEND = 'https://app.test';

  function build() {
    const microsoft = {
      handleCallback: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new MicrosoftController(
      microsoft as unknown as MicrosoftService,
    );
    const res = { redirect: jest.fn() };
    const logged: string[] = [];
    jest
      .spyOn(
        (controller as unknown as { logger: { error: (m: string) => void } })
          .logger,
        'error',
      )
      .mockImplementation((m: string) => void logged.push(m));
    return { controller, microsoft, res, logged };
  }

  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = FRONTEND;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  /** What the redirect carried back to the user, decoded. */
  const reasonOf = (res: { redirect: jest.Mock }) =>
    decodeURIComponent(
      String((res.redirect.mock.calls[0] as string[])[0]).split('reason=')[1] ??
        '',
    );

  it('does NOT try to redeem a callback that carries an error', async () => {
    // ⚠️ The whole point. There is no code to redeem, and calling anyway is what replaced
    // Microsoft's explanation with MSAL's complaint about a missing argument.
    const { controller, microsoft, res } = build();

    await controller.callback(
      undefined as unknown as string,
      'state-1',
      res as never,
      'access_denied',
      'AADSTS65004: User declined to consent.',
      'cancel',
    );

    expect(microsoft.handleCallback).not.toHaveBeenCalled();
  });

  it('LOGS the AADSTS description, which is the whole diagnosis', async () => {
    const { controller, res, logged } = build();

    await controller.callback(
      undefined as unknown as string,
      'state-1',
      res as never,
      'access_denied',
      'AADSTS65001: The user or administrator has not consented.',
      'cancel',
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('access_denied');
    expect(logged[0]).toContain('cancel');
    expect(logged[0]).toContain('AADSTS65001');
  });

  it('shows the user Microsoft’s own words, not ours', async () => {
    const { controller, res } = build();

    await controller.callback(
      undefined as unknown as string,
      'state-1',
      res as never,
      'access_denied',
      'AADSTS65001: The user or administrator has not consented.',
      'cancel',
    );

    expect(reasonOf(res)).toContain('AADSTS65001');
  });

  it('still says something useful when there is no description', async () => {
    // A bare `error` with no description is legal; falling back to an empty reason would
    // render the error page with nothing on it.
    const { controller, res } = build();

    await controller.callback(
      undefined as unknown as string,
      'state-1',
      res as never,
      'access_denied',
      undefined,
      'cancel',
    );

    expect(reasonOf(res)).toContain('access_denied');
    expect(reasonOf(res)).toContain('cancel');
  });

  it('redeems and reports success when a code DOES come back', async () => {
    // The unchanged path, pinned so the new branch cannot swallow a good connect.
    const { controller, microsoft, res } = build();

    await controller.callback('the-code', 'state-1', res as never);

    expect(microsoft.handleCallback).toHaveBeenCalledWith(
      'the-code',
      'state-1',
    );
    expect(res.redirect).toHaveBeenCalledWith(`${FRONTEND}/microsoft/success`);
  });

  it('logs a failure that happens AFTER the code came back', async () => {
    // Previously silent server-side, and harder to reconstruct than a refused consent.
    const { controller, microsoft, res, logged } = build();
    microsoft.handleCallback.mockRejectedValue(
      new Error('token exchange blew up'),
    );

    await controller.callback('the-code', 'state-1', res as never);

    expect(logged[0]).toContain('token exchange blew up');
    expect(reasonOf(res)).toContain('token exchange blew up');
  });
});
