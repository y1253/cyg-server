import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PLACEHOLDERS } from './phone-message.util.js';
import { type EffectivePhoneSettings, type PhoneSettingsOverrides, type SettingsSource } from './phone-settings.util.js';
import type { UpdateCompanyPhoneSettingsDto } from './dto/update-company-phone-settings.dto.js';
import type { UpdatePhoneDefaultsDto } from './dto/update-phone-defaults.dto.js';
export interface CompanyPhoneSettingsView {
    companyId: number;
    companyName: string;
    overrides: PhoneSettingsOverrides;
    effective: EffectivePhoneSettings;
    source: SettingsSource;
    defaults: EffectivePhoneSettings;
    isOpenNow: boolean;
    hoursToday: string;
    placeholders: typeof PLACEHOLDERS;
}
export declare class PhoneSettingsService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    getDefaults(): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        voice: string;
        timezone: string;
        weeklyHours: Prisma.JsonValue;
        greetingMessage: string;
        afterHoursMessage: string;
        unavailableMessage: string;
        playGreeting: boolean;
        afterHoursHangUp: boolean;
        hoursEnabled: boolean;
        ringTimeoutSeconds: number;
        singleton: string;
    }>;
    updateDefaults(dto: UpdatePhoneDefaultsDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        voice: string;
        timezone: string;
        weeklyHours: Prisma.JsonValue;
        greetingMessage: string;
        afterHoursMessage: string;
        unavailableMessage: string;
        playGreeting: boolean;
        afterHoursHangUp: boolean;
        hoursEnabled: boolean;
        ringTimeoutSeconds: number;
        singleton: string;
    }>;
    getForCompany(companyId: number): Promise<CompanyPhoneSettingsView>;
    updateForCompany(companyId: number, dto: UpdateCompanyPhoneSettingsDto): Promise<CompanyPhoneSettingsView>;
    resetForCompany(companyId: number): Promise<CompanyPhoneSettingsView>;
    effectiveFor(companyId: number | null): Promise<EffectivePhoneSettings>;
    preview(template: string, companyId?: number, at?: string): Promise<{
        text: string;
        isOpen: boolean;
    }>;
    private pickPresent;
    private assertCompany;
    private buildView;
}
