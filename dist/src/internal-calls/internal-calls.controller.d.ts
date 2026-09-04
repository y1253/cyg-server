import { InternalCallsService } from './internal-calls.service.js';
import { StartInternalCallDto } from './dto/start-internal-call.dto.js';
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
    recordings(req: AuthedRequest, sid: string): Promise<{
        recordings: import("./internal-calls.service.js").InternalRecordingView[];
        summary: import("../phone/call-summary.util.js").CallSummaryView | null;
    }>;
}
export {};
