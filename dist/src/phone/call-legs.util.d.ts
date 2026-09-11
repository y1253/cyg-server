import type { SwCall } from './signalwire-parse.js';
import type { SwParticipant } from './signalwire-parse.js';
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
export type TransferState = 'ringing' | 'answered' | 'no-answer' | 'ended';
export interface TransferRecord {
    peerSid: string;
    previousAgentSid: string | null;
    target: {
        id: number;
        name: string;
    };
    at: number;
}
export declare function transferStateOf(peer: SwCall | null, children: SwCall[], record: TransferRecord): TransferState;
export interface ConferenceParty {
    id: string;
    legSid: string;
    label: string;
    kind: 'peer' | 'user' | 'number';
}
export interface ConferenceRecord {
    room: string;
    kind: CallKind;
    agentSid: string;
    rootJoined: boolean;
    rootSid: string;
    parties: ConferenceParty[];
    companyId: number;
    nextPartyId: number;
    at: number;
}
export type PartyState = 'ringing' | 'connected' | 'held' | 'gone';
export interface PartyView {
    id: string;
    label: string;
    state: PartyState;
}
export interface ConferenceView {
    active: boolean;
    parties: PartyView[];
    merged: boolean;
    canAdd: boolean;
    canSwap: boolean;
}
export declare const MAX_ADDED_PARTIES = 4;
export declare function conferenceStateOf(participants: SwParticipant[], record: ConferenceRecord, liveLegSids: ReadonlySet<string>): ConferenceView;
