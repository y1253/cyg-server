import { MAX_RINGING_MS, PRE_ANSWER } from './phone-timeline.util.js';
import type { SwCall } from './signalwire-parse.js';
export declare const ACTIVE_CALL_TTL_MS: number;
export declare const RECONCILE_EVERY_MS = 30000;
export declare const CLEAR_GRACE_MS = 10000;
export declare const LIVE_LOOKBACK_MS = 10000;
export { MAX_RINGING_MS, PRE_ANSWER };
export declare const TERMINAL_RETRY_MS = 5000;
export interface ActiveCall {
    companyId: number;
    supportNumber: string;
    callSid: string | null;
    direction: 'inbound' | 'outbound';
    state: 'dialing' | 'ringing' | 'active';
    userId: number | null;
    userName: string | null;
    peer: string;
    peerName: string | null;
    startedAt: number;
    answeredAt: number | null;
    verifiedAt: number;
}
export interface ActiveCallView {
    companyId: number;
    callSid: string | null;
    direction: ActiveCall['direction'];
    state: ActiveCall['state'];
    userName: string | null;
    isViewer: boolean;
    peer: string;
    peerName: string | null;
    elapsedSec: number;
}
export declare function isExpired(entry: ActiveCall, now: number): boolean;
export declare function needsReconcile(entry: ActiveCall, now: number): boolean;
export declare function shouldClear(entry: ActiveCall, liveCount: number, now: number): boolean;
export declare function liveOnly(rows: SwCall[], now?: number): SwCall[];
export declare function entryFromLiveRow(companyId: number, supportNumber: string, row: SwCall, now: number): ActiveCall;
export declare function elapsedSecOf(entry: ActiveCall, now: number): number;
export declare function toView(entry: ActiveCall, now: number, viewerId: number): ActiveCallView;
export declare function busyMessage(companyName: string, entry: ActiveCall, now: number): string;
