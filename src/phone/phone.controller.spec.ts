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
