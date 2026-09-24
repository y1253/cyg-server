import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from './signalwire.service.js';
export declare class RingGroupService {
    private readonly prisma;
    private readonly signalwire;
    private readonly logger;
    private static readonly TTL_MS;
    private static readonly CHILD_POLL_MS;
    private static readonly MAX_GREETING_WAIT_MS;
    private readonly groups;
    constructor(prisma: PrismaService, signalwire: SignalWireService);
    start(input: {
        callSid: string;
        companyId: number;
        companyName: string;
        supportNumber: string;
        from: string;
        fromName: string | null;
        phones: {
            userId: number;
            e164: string;
        }[];
        ringTimeoutSeconds: number;
        voice?: string;
        hasGreeting: boolean;
    }): Promise<void>;
    browserAnswered(callSid: string): Promise<void>;
    screenAccept(legSid: string, digits: string): Promise<string>;
    forget(callSid: string): void;
    has(callSid: string): boolean;
    private moveCallerToRoom;
    private markAnsweredOnMobile;
    private cancelLegs;
    private waitForDialChild;
    private findByLeg;
    private spoken;
    private sweep;
}
