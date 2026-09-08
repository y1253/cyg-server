import type { SwCall } from './signalwire-parse.js';
export type CallKind = 'inbound' | 'outbound' | 'internal';
export interface Legs {
    rootSid: string;
    agentSid: string | null;
    peerSid: string | null;
}
export interface LegContext {
    requesterIsCaller?: boolean;
}
export declare function pickConnectedChild(children: SwCall[]): SwCall | null;
export declare function conferenceRoomFor(rootSid: string): string;
export declare function rootSidFromRoom(room: string): string | null;
export declare function classifyLegs(root: SwCall, children: SwCall[], kind: CallKind, ctx?: LegContext): Legs;
