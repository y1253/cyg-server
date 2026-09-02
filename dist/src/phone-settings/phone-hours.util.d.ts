import type { WeeklyHours } from './phone-settings.util.js';
export interface ZonedNow {
    weekday: number;
    minutes: number;
}
export declare function zonedNow(at: Date, timeZone: string): ZonedNow;
export declare function isValidTimeZone(timeZone: unknown): boolean;
export declare function isOpenAt(week: WeeklyHours, timeZone: string, at: Date): boolean;
export declare function describeToday(week: WeeklyHours, timeZone: string, at: Date): string;
