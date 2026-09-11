import { PrismaService } from '../prisma/prisma.service';
import { SignalWireService } from './signalwire.service';
import { PhoneEventsService } from './phone-events.service';
import { CallControlService, type CallContext } from './call-control.service';
import { type ConferenceRecord, type ConferenceView } from './call-legs.util';
export type AddTarget = {
    userId: number;
} | {
    phone: string;
} | {
    contactId: number;
};
export declare class ConferenceService {
    private prisma;
    private signalwire;
    private events;
    private callControl;
    private readonly logger;
    private static readonly RING_TIMEOUT;
    private static readonly TTL_MS;
    private static readonly ROOM_LOOKUP_ATTEMPTS;
    private static readonly ROOM_LOOKUP_DELAY_MS;
    private readonly conferences;
    constructor(prisma: PrismaService, signalwire: SignalWireService, events: PhoneEventsService, callControl: CallControlService);
    awaitingRootJoin(callSid: string): ConferenceRecord | null;
    recordForLeg(callSid: string): ConferenceRecord | null;
    addCall(ctx: CallContext, target: AddTarget): Promise<ConferenceView>;
    setPartyHold(ctx: CallContext, partyId: string, held: boolean): Promise<ConferenceView>;
    swap(ctx: CallContext): Promise<ConferenceView>;
    merge(ctx: CallContext): Promise<ConferenceView>;
    dropParty(ctx: CallContext, partyId: string): Promise<ConferenceView>;
    conferenceStatus(rootSid: string): Promise<ConferenceView>;
    private beginConference;
    private resolveAddTarget;
    private supportNumberFor;
    private contactRow;
    private contactNumber;
    private contactLabel;
    private setHold;
    private holdAll;
    private conferenceSidFor;
    private requireConferenceSid;
    private viewOf;
    private inactive;
    private requireRecord;
    private requireParty;
    private sweep;
}
