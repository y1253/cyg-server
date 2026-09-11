export type ConferenceRole = 'agent' | 'party';
export interface ConferenceDocInput {
    room: string;
    role: ConferenceRole;
    isRoot: boolean;
    holdUrl?: string;
    statusCallback?: string;
    env?: Record<string, string | undefined>;
}
export declare function conferenceDoc(input: ConferenceDocInput): string;
