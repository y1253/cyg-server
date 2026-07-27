export interface ScheduleForDue {
    cycle: number;
    cycleType: string;
    cycleDay: number | null;
    cycleNth: number | null;
}
export declare const LAST_DAY_OF_MONTH = 0;
export declare function parseDateOnly(input: string | Date): Date;
export declare function computeNextDue(base: Date, schedule: ScheduleForDue): Date;
export declare function computeFirstDue(startDate: Date, schedule: ScheduleForDue): Date;
