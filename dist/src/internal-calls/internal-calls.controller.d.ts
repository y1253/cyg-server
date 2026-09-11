import { InternalCallsService } from './internal-calls.service.js';
import { StartInternalCallDto } from './dto/start-internal-call.dto.js';
import { TransferCallDto } from '../phone/dto/transfer-call.dto.js';
import { PartyDto, PartyHoldDto } from '../phone/dto/conference.dto.js';
type AuthedRequest = {
    user: {
        userId: number;
    };
};
export declare class InternalCallsController {
    private readonly service;
    constructor(service: InternalCallsService);
    list(req: AuthedRequest, folder?: string, cursor?: string, limit?: string): Promise<import("./internal-calls.service.js").InternalCallListResult>;
    counts(req: AuthedRequest): Promise<{
        unread: number;
        uncompleted: number;
    }>;
    start(req: AuthedRequest, dto: StartInternalCallDto): Promise<{
        callSid: string;
        peer: {
            id: number;
            name: string;
        };
    }>;
    transferBlind(sid: string, dto: TransferCallDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        transferredSid: string;
    }>;
    transferStatus(req: AuthedRequest, sid: string): Promise<{
        state: import("../phone/call-legs.util.js").TransferState;
        targetName: string | null;
    }>;
    conferenceAdd(sid: string, dto: TransferCallDto, req: AuthedRequest): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceHold(sid: string, dto: PartyHoldDto, req: AuthedRequest): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceSwap(sid: string, req: AuthedRequest): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceMerge(sid: string, req: AuthedRequest): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceDrop(sid: string, dto: PartyDto, req: AuthedRequest): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceStatus(sid: string, req: AuthedRequest): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    recordings(req: AuthedRequest, sid: string): Promise<{
        recordings: import("./internal-calls.service.js").InternalRecordingView[];
        summary: import("../phone/call-summary.util.js").CallSummaryView | null;
    }>;
    markRead(req: AuthedRequest, sid: string): Promise<void>;
    markUnread(req: AuthedRequest, sid: string): Promise<void>;
    markComplete(req: AuthedRequest, sid: string): Promise<void>;
    markUncomplete(req: AuthedRequest, sid: string): Promise<void>;
}
export {};
