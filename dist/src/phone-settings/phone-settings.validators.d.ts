import { type ValidationOptions } from 'class-validator';
export declare function IsIanaTimeZone(options?: ValidationOptions): (object: object, propertyName: string) => void;
export declare function IsWeeklyHours(options?: ValidationOptions): (object: object, propertyName: string) => void;
