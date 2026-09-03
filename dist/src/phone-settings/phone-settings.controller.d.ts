import { PhoneSettingsService } from './phone-settings.service.js';
import { UpdatePhoneDefaultsDto } from './dto/update-phone-defaults.dto.js';
import { UpdateCompanyPhoneSettingsDto } from './dto/update-company-phone-settings.dto.js';
import { PreviewMessageDto } from './dto/preview-message.dto.js';
export declare class PhoneSettingsController {
    private readonly settings;
    constructor(settings: PhoneSettingsService);
    getDefaults(): Promise<{
        defaults: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            voice: string;
            timezone: string;
            weeklyHours: import("@prisma/client/runtime/library").JsonValue;
            greetingMessage: string;
            afterHoursMessage: string;
            unavailableMessage: string;
            playGreeting: boolean;
            afterHoursHangUp: boolean;
            hoursEnabled: boolean;
            ringTimeoutSeconds: number;
            holdAudioId: number;
            voicemailEnabled: boolean;
            voicemailPrompt: string;
            voicemailMaxSeconds: number;
            singleton: string;
        };
        placeholders: readonly [{
            readonly token: "{company name}";
            readonly label: "Company name";
            readonly key: "company";
            readonly example: "Acme Bookkeeping";
        }, {
            readonly token: "{phone}";
            readonly label: "Support number";
            readonly key: "phone";
            readonly example: "+1 438 256 1210";
        }, {
            readonly token: "{hours}";
            readonly label: "Today's hours";
            readonly key: "hours";
            readonly example: "9 AM to 5 PM";
        }];
    }>;
    updateDefaults(dto: UpdatePhoneDefaultsDto): Promise<{
        defaults: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            voice: string;
            timezone: string;
            weeklyHours: import("@prisma/client/runtime/library").JsonValue;
            greetingMessage: string;
            afterHoursMessage: string;
            unavailableMessage: string;
            playGreeting: boolean;
            afterHoursHangUp: boolean;
            hoursEnabled: boolean;
            ringTimeoutSeconds: number;
            holdAudioId: number;
            voicemailEnabled: boolean;
            voicemailPrompt: string;
            voicemailMaxSeconds: number;
            singleton: string;
        };
        placeholders: readonly [{
            readonly token: "{company name}";
            readonly label: "Company name";
            readonly key: "company";
            readonly example: "Acme Bookkeeping";
        }, {
            readonly token: "{phone}";
            readonly label: "Support number";
            readonly key: "phone";
            readonly example: "+1 438 256 1210";
        }, {
            readonly token: "{hours}";
            readonly label: "Today's hours";
            readonly key: "hours";
            readonly example: "9 AM to 5 PM";
        }];
    }>;
    getForCompany(companyId: number): Promise<import("./phone-settings.service.js").CompanyPhoneSettingsView>;
    updateForCompany(companyId: number, dto: UpdateCompanyPhoneSettingsDto): Promise<import("./phone-settings.service.js").CompanyPhoneSettingsView>;
    resetForCompany(companyId: number): Promise<import("./phone-settings.service.js").CompanyPhoneSettingsView>;
    preview(dto: PreviewMessageDto): Promise<{
        text: string;
        isOpen: boolean;
    }>;
}
