import { PhoneTimelineService } from './phone-timeline.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SignalWireService } from './signalwire.service';
import type { MessageStateService } from '../communications/message-state.service';
import type { SwCall, SwRecording } from './signalwire-parse';

/**
 * The row and the detail view must agree about whether audio exists.
 *
 * `buildPhoneItems` drops a sub-threshold recording, so a call somebody hung up on at the
 * beep renders as a plain missed call. If `getCallRecordings` did not apply the SAME rule,
 * that row would open onto a player holding a second of line noise — the list/detail
 * disagreement this module has already paid for once, with `hasRecording` on outbound
 * calls.
 *
 * It also pins the other half: `findRecordingsForCall` stays UNFILTERED, because the
 * summary worker wants the longest recording it can find and has its own empty-transcript
 * skip.
 */
describe('PhoneTimelineService.getCallRecordings — the audible gate', () => {
  const CALL_SID = 'b9c4489d-f26c-4cf0-96cb-23d8c50398d4';

  function rec(over: Partial<SwRecording> = {}): SwRecording {
    return {
      sid: 'rec-1',
      callSid: CALL_SID,
      durationSec: 12,
      status: 'completed',
      createdAt: Date.UTC(2026, 7, 28, 16, 0, 0),
      ...over,
    };
  }

  function build(recordings: SwRecording[]) {
    const svc = new PhoneTimelineService(
      {} as PrismaService,
      {} as SignalWireService,
      {} as MessageStateService,
    );
    (svc as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger =
      {
        log: jest.fn(),
        warn: jest.fn(),
      };
    // The ownership check is what the streaming token attests to; it has its own tests.
    (svc as unknown as { assertCallBelongsTo: jest.Mock }).assertCallBelongsTo =
      jest.fn().mockResolvedValue({ sid: CALL_SID } as SwCall);
    const find = jest.fn().mockResolvedValue({ recordings, onSid: CALL_SID });
    (
      svc as unknown as { findRecordingsForCall: jest.Mock }
    ).findRecordingsForCall = find;
    return { svc, find };
  }

  it('hides a hang-up at the beep', async () => {
    const { svc } = build([rec({ durationSec: 1 })]);
    await expect(svc.getCallRecordings(1, CALL_SID)).resolves.toEqual([]);
  });

  it('returns a real message, with a token minted', async () => {
    const { svc } = build([rec({ durationSec: 12 })]);
    const out = await svc.getCallRecordings(1, CALL_SID);

    expect(out).toHaveLength(1);
    expect(out[0].sid).toBe('rec-1');
    expect(out[0].durationSec).toBe(12);
    expect(out[0].token).toBeTruthy();
  });

  it('keeps only the audible one when a call has both', async () => {
    const { svc } = build([
      rec({ sid: 'blip', durationSec: 1 }),
      rec({ sid: 'message', durationSec: 30 }),
    ]);
    const out = await svc.getCallRecordings(1, CALL_SID);

    expect(out.map((r) => r.sid)).toEqual(['message']);
  });

  it('leaves findRecordingsForCall unfiltered — the summary worker reads it raw', async () => {
    const { svc, find } = build([rec({ durationSec: 1 })]);
    await svc.getCallRecordings(1, CALL_SID);

    const raw = (await find.mock.results[0].value) as {
      recordings: SwRecording[];
    };
    expect(raw.recordings).toHaveLength(1);
  });
});
