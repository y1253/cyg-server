import { BadRequestException } from '@nestjs/common';
import { PhoneController } from './phone.controller';
import type { SwCall } from './signalwire-parse';

/**
 * Hold and resume pause the call's RECORDING, so the hold music the browser plays is not
 * captured. The recording lives on the root the `<Dial record>` ran on.
 *
 * On a forked click-to-call the client can hold a DEAD twin of that root. Pausing "its"
 * recording would find nothing, and the hold music would end up in the recording — so these
 * tests pin that the recording calls land on the LIVE twin, and that the resolver can never
 * turn a best-effort pause into an error the agent sees.
 */

const T = 1_700_000_000_000;

function call(over: Partial<SwCall> & { sid: string }): SwCall {
  return {
    parentCallSid: null,
    to: 'sip:testcyg@cygfinance.sip.signalwire.com',
    from: 'sip:+14382563856@sip.signalwire.com',
    direction: 'outbound-api',
    status: 'no-answer',
    startedAt: T,
    durationSec: 0,
    ...over,
  };
}

function setup(clientCall: SwCall) {
  const signalwire = {
    listRecordings: jest.fn().mockResolvedValue([
      { sid: 'rec-1', callSid: 'live', status: 'in-progress', durationSec: 5 },
    ]),
    updateRecording: jest.fn().mockResolvedValue(true),
  };
  const timeline = {
    assertCallBelongsTo: jest.fn().mockResolvedValue(clientCall),
  };
  const callControl = {
    resolveLiveRoot: jest.fn().mockResolvedValue(call({ sid: 'live', status: 'in-progress' })),
  };
  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        businessName: 'Acme Bookkeeping',
        // The requester is assigned, so assertMayUseCompanyPhone passes without a role read.
        assignments: [{ userId: 1 }],
      }),
    },
  };

  const stub = {} as never;
  const controller = new PhoneController(
    stub, // provisioning
    stub, // events
    timeline as never,
    stub, // dialer
    stub, // state
    signalwire as never,
    prisma as never,
    stub, // audio
    stub, // settings
    stub, // summaries
    callControl as never,
    stub, // conference
    stub, // activeCalls
  );
  return { controller, signalwire, timeline, callControl };
}

const REQ = { user: { userId: 1 } };

describe('hold / resume on a forked click-to-call', () => {
  it('pauses the recording on the LIVE twin, not the dead sid the client holds', async () => {
    const { controller, signalwire, callControl } = setup(call({ sid: 'dead' }));

    await expect(controller.hold(1, 'dead', REQ)).resolves.toEqual({
      recordingPaused: true,
    });
    expect(callControl.resolveLiveRoot).toHaveBeenCalledWith(
      expect.objectContaining({ sid: 'dead' }),
      'recording dead',
    );
    expect(signalwire.listRecordings).toHaveBeenCalledWith({ callSid: 'live' });
    expect(signalwire.updateRecording).toHaveBeenCalledWith('live', 'rec-1', 'paused');
  });

  it('resumes on the live twin too', async () => {
    const { controller, signalwire } = setup(call({ sid: 'dead' }));
    await controller.resume(1, 'dead', REQ);
    expect(signalwire.updateRecording).toHaveBeenCalledWith('live', 'rec-1', 'in-progress');
  });

  /**
   * Hold is best-effort by design: the browser plays the music whatever happens here, and
   * failing the request would strand the caller in silence. An ambiguous twin must degrade
   * to "not paused", never to an error.
   */
  it('degrades to not-paused when the twin cannot be identified', async () => {
    const { controller, callControl, signalwire } = setup(call({ sid: 'dead' }));
    callControl.resolveLiveRoot.mockRejectedValue(
      new BadRequestException('Several calls started on this line'),
    );

    await expect(controller.hold(1, 'dead', REQ)).resolves.toEqual({
      recordingPaused: false,
    });
    expect(signalwire.updateRecording).not.toHaveBeenCalled();
  });

  it('never asks for a twin on an inbound call, where the root is the customer', async () => {
    // The agent is not on the root of an inbound call, so there is nothing to resolve.
    const inbound = call({
      sid: 'inbound-root',
      direction: 'inbound',
      status: 'in-progress',
      to: '+14382563856',
      from: '+15145550000',
    });
    const { controller, signalwire, callControl } = setup(inbound);

    await controller.hold(1, 'inbound-root', REQ);
    expect(callControl.resolveLiveRoot).not.toHaveBeenCalled();
    expect(signalwire.listRecordings).toHaveBeenCalledWith({ callSid: 'inbound-root' });
  });
});

/**
 * "End & complete" writes against the row the INBOX renders, which is not always the leg
 * the browser is on. Getting this wrong is silent — the write lands on an id nothing reads
 * back and the call just never shows as completed — and this codebase has already paid for
 * the same inversion twice (`hasRecording`, then `summaryLookupSids`).
 */
describe('completing the call the agent just finished', () => {
  const SUPPORT = '+14382563856';

  function completeSetup(
    clientCall: SwCall,
    rowItemId: string | null = 'swcall:x',
  ) {
    const timeline = {
      assertCallBelongsToNumber: jest
        .fn()
        .mockResolvedValue({ call: clientCall, supportNumber: SUPPORT }),
      rowItemIdForCall: jest.fn().mockResolvedValue(rowItemId),
      refreshCompanyCounts: jest.fn().mockResolvedValue(undefined),
      bust: jest.fn(),
    };
    const state = { markComplete: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      company: {
        findFirst: jest.fn().mockResolvedValue({
          businessName: 'Acme Bookkeeping',
          assignments: [{ userId: 1 }],
        }),
      },
    };
    const stub = {} as never;
    const controller = new PhoneController(
      stub, stub,
      timeline as never,
      stub,
      state as never,
      stub,
      prisma as never,
      stub, stub, stub, stub, stub, stub,
    );
    return { controller, timeline, state };
  }

  it('completes the row id the timeline resolves, not the sid it was handed', async () => {
    const root = call({ sid: 'outbound-root', direction: 'outbound-api' });
    const { controller, timeline, state } = completeSetup(root, 'swcall:child');

    await expect(controller.completeCall(1, 'outbound-root', REQ)).resolves.toEqual({
      itemId: 'swcall:child',
    });
    expect(timeline.rowItemIdForCall).toHaveBeenCalledWith(root, SUPPORT);
    // The CHILD, never `swcall:outbound-root` — that row does not exist.
    expect(state.markComplete).toHaveBeenCalledWith(1, 'swcall:child');
  });

  it('recounts the badges before answering, and busts the window', async () => {
    const { controller, timeline } = completeSetup(call({ sid: 'r' }));
    await controller.completeCall(1, 'r', REQ);
    expect(timeline.refreshCompanyCounts).toHaveBeenCalledWith(1);
    expect(timeline.bust).toHaveBeenCalledWith(1);
  });

  /**
   * Silence here would be the worst outcome: the agent sees a success, the call stays in
   * their worklist, and nothing anywhere says why.
   */
  it('fails loudly when no row can be identified, writing nothing', async () => {
    const { controller, state } = completeSetup(call({ sid: 'r' }), null);
    await expect(controller.completeCall(1, 'r', REQ)).rejects.toThrow(
      /no inbox row/i,
    );
    expect(state.markComplete).not.toHaveBeenCalled();
  });
});
