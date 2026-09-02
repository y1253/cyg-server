export type DayHours = {
    open: string;
    close: string;
};
export type WeeklyHours = (DayHours | null)[];
export interface EffectivePhoneSettings {
    timezone: string;
    weeklyHours: WeeklyHours;
    greetingMessage: string;
    afterHoursMessage: string;
    unavailableMessage: string;
    playGreeting: boolean;
    afterHoursHangUp: boolean;
    hoursEnabled: boolean;
    ringTimeoutSeconds: number;
    voice: string;
}
export type SettingsSource = Record<keyof EffectivePhoneSettings, 'company' | 'default'>;
export type PhoneSettingsOverrides = {
    [K in keyof EffectivePhoneSettings]: EffectivePhoneSettings[K] | null;
};
export declare const SETTINGS_SINGLETON = "GLOBAL";
export declare const SETTINGS_FIELDS: readonly ["timezone", "weeklyHours", "greetingMessage", "afterHoursMessage", "unavailableMessage", "playGreeting", "afterHoursHangUp", "hoursEnabled", "ringTimeoutSeconds", "voice"];
export declare const FALLBACK_WEEK: WeeklyHours;
export declare const SEED_DEFAULTS: EffectivePhoneSettings;
export declare const HARDCODED_FALLBACK: EffectivePhoneSettings;
export declare function parseTime(value: unknown): number | null;
export declare function parseWeeklyHours(raw: unknown): WeeklyHours | null;
export type RawDefaults = Omit<EffectivePhoneSettings, 'weeklyHours'> & {
    weeklyHours: unknown;
};
export type RawOverrides = {
    [K in keyof EffectivePhoneSettings]?: K extends 'weeklyHours' ? unknown : EffectivePhoneSettings[K] | null;
};
export declare function resolveSettings(global: RawDefaults | null, company: RawOverrides | null): {
    effective: EffectivePhoneSettings;
    source: SettingsSource;
};
