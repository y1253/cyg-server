import { Subject } from 'rxjs';
import type { RealtimeBatch, RealtimeEvent, RealtimePublishOptions, RealtimeTopic } from './realtime.types.js';
export declare class RealtimeService {
    private readonly logger;
    private seq;
    private buffer;
    private waiters;
    readonly events$: Subject<RealtimeEvent>;
    publish(topic: RealtimeTopic, opts?: RealtimePublishOptions): void;
    wait(userId: number, since: number, holdMs?: number): Promise<RealtimeBatch>;
    get waiterCount(): number;
    get cursor(): number;
    private notify;
    private wake;
    private batchFor;
    private sweep;
}
export declare function visibleTo(event: RealtimeEvent, userId: number): boolean;
