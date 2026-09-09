import { PrismaService } from '../prisma/prisma.service';
import { SignalWireService } from './signalwire.service';
import { PhoneEventsService } from './phone-events.service';
import { type CallKind, type Legs, type TransferState } from './call-legs.util';
export interface TransferContext {
    rootSid: string;
    kind: CallKind;
    requesterIsCaller?: boolean;
    requester: {
        id: number;
        name: string;
    };
    companyId: number;
    companyName: string;
}
export declare class CallControlService {
    private prisma;
    private signalwire;
    private events;
    private readonly logger;
    private static readonly RING_TIMEOUT;
    private static readonly TRANSFER_TTL_MS;
    private readonly transfers;
    constructor(prisma: PrismaService, signalwire: SignalWireService, events: PhoneEventsService);
    resolveTarget(targetUserId: number, requesterId: number, forbidden?: number[]): Promise<{
        id: number;
        name: string;
    }>;
    legsFor(ctx: TransferContext): Promise<Legs>;
    blindTransfer(ctx: TransferContext, target: {
        id: number;
        name: string;
    }): Promise<{
        transferredSid: string;
        target: {
            id: number;
            name: string;
        };
    }>;
    transferStatus(rootSid: string): Promise<{
        state: TransferState;
        targetName: string | null;
    }>;
    private sweepTransfers;
    private counterpartyLabel;
}
