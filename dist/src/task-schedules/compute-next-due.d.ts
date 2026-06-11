export interface ScheduleForDue {
    cycle: number;
    cycleType: string;
    cycleDay: number | null;
    cycleNth: number | null;
}
export declare function computeNextDue(base: Date, schedule: ScheduleForDue): Date;
export declare function computeFirstDue(startDate: Date, schedule: ScheduleForDue): Date;
