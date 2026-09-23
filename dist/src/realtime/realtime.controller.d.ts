import { RealtimeService } from './realtime.service.js';
import type { RealtimeBatch } from './realtime.types.js';
type AuthedRequest = {
    user: {
        userId: number;
    };
};
export declare class RealtimeController {
    private readonly realtime;
    constructor(realtime: RealtimeService);
    events(req: AuthedRequest, since?: string): Promise<RealtimeBatch>;
}
export {};
