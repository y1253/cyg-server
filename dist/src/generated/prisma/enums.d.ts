export declare const Role: {
    readonly ADMIN: "ADMIN";
    readonly EMPLOYEE: "EMPLOYEE";
};
export type Role = (typeof Role)[keyof typeof Role];
export declare const TaskStatus: {
    readonly PENDING: "PENDING";
    readonly IN_PROGRESS: "IN_PROGRESS";
    readonly DONE: "DONE";
};
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
