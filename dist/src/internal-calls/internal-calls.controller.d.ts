import { InternalCallsService } from './internal-calls.service.js';
import { StartInternalCallDto } from './dto/start-internal-call.dto.js';
import { TransferCallDto } from '../phone/dto/transfer-call.dto.js';
type AuthedRequest = {
    user: {
        userId: number;
    };
};
export declare class InternalCallsController {
    private readonly service;
    constructor(service: InternalCallsService);
    list(req: AuthedRequest, limit?: string): Promise<import("./internal-calls.service.js").InternalCallView[]>;
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
    recordings(req: AuthedRequest, sid: string): Promise<{
        recordings: import("./internal-calls.service.js").InternalRecordingView[];
        summary: import("../phone/call-summary.util.js").CallSummaryView | null;
    }>;
}
export {};
