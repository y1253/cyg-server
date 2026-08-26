import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
export declare class PhoneController {
    private readonly provisioning;
    constructor(provisioning: PhoneProvisioningService);
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
