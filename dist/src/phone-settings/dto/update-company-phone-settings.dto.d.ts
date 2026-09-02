import type { WeeklyHours } from '../phone-settings.util.js';
export declare class UpdateCompanyPhoneSettingsDto {
    timezone?: string | null;
    weeklyHours?: WeeklyHours | null;
    greetingMessage?: string | null;
    afterHoursMessage?: string | null;
    unavailableMessage?: string | null;
    playGreeting?: boolean | null;
    afterHoursHangUp?: boolean | null;
    hoursEnabled?: boolean | null;
    ringTimeoutSeconds?: number | null;
    voice?: string | null;
}
