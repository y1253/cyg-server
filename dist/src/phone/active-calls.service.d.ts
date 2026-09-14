import { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { SignalWireService } from './signalwire.service.js';
import { type ActiveCall } from './active-calls.util.js';
export interface ActiveCallClaim {
    commit(callSid: string): void;
    release(): void;
}
export declare class ActiveCallsService {
    private readonly signalwire;
    private readonly prisma;
    private readonly contacts;
    private readonly logger;
    private readonly calls;
    private readonly reconciling;
    constructor(signalwire: SignalWireService, prisma: PrismaService, contacts: ContactsService);
    claim(input: {
        companyId: number;
        companyName: string;
        supportNumber: string;
        userId: number;
        peer: string;
    }): Promise<ActiveCallClaim>;
    noteInboundRinging(input: {
        companyId: number;
        supportNumber: string;
        callSid: string;
        from: string;
        fromName: string | null;
    }): void;
    markAnswered(companyId: number, callSid: string, userId: number): Promise<boolean>;
    get(companyId: number): ActiveCall | null;
    onTerminalStatus(callSid: string, to: string, from: string): Promise<void>;
    reconcile(companyId: number): Promise<boolean>;
    private holds;
    private replaceEntry;
    private list;
    private current;
    private findCompany;
    private everyEntry;
    private dropSid;
    private liveCallsOn;
    private fillNames;
}
