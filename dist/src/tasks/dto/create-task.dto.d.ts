export declare class CreateTaskDto {
    title: string;
    description?: string;
    defaultCycle?: number;
    defaultCycleType?: string;
    defaultCycleDay?: number;
    defaultCycleNth?: number;
    isImportant?: boolean;
    canBeDisabled?: boolean;
    isSnoozable?: boolean;
    orderNumber?: number;
}
