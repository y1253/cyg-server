import type { WeeklyHours } from '../phone-settings.util.js';
export declare class UpdatePhoneDefaultsDto {
    timezone?: string;
    weeklyHours?: WeeklyHours;
    greetingMessage?: string;
    afterHoursMessage?: string;
    unavailableMessage?: string;
    playGreeting?: boolean;
    afterHoursHangUp?: boolean;
    hoursEnabled?: boolean;
    ringTimeoutSeconds?: number;
    voice?: string;
}
