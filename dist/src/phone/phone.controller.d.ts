import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
import { PhoneEventsService } from './phone-events.service.js';
import { Observable } from 'rxjs';
import type { Request as ExpressRequest } from 'express';
interface MessageEvent {
    data: string;
}
export declare class PhoneController {
    private readonly provisioning;
    private readonly events;
    constructor(provisioning: PhoneProvisioningService, events: PhoneEventsService);
    getSipCredentials(): {
        domain: string;
        username: string;
        password: string;
        wsServer: string;
    };
    streamEvents(token: string, req: ExpressRequest): Observable<MessageEvent>;
    searchAvailable(country: string, areaCode?: string): Promise<import("./signalwire-parse.js").AvailableNumber[]>;
    getNumber(companyId: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        region: string | null;
        sid: string;
        phoneNumber: string;
        activeForCompanyId: number | null;
        releasedAt: Date | null;
    } | null>;
    attachNumber(companyId: number, dto: AttachNumberDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        region: string | null;
        sid: string;
        phoneNumber: string;
        activeForCompanyId: number | null;
        releasedAt: Date | null;
    }>;
    releaseNumber(companyId: number): Promise<void>;
}
export {};
