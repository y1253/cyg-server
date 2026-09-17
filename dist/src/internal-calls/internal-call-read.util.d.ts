export type InternalCallOutcome = 'answered' | 'missed' | 'in-progress';
export declare function isImplicitlyReadInternalCall(direction: 'inbound' | 'outbound', outcome: InternalCallOutcome): boolean;
export interface AnsweredWhere {
    AND: [{
        status: {
            notIn: string[];
        };
    }, {
        durationSec: {
            gt: number;
        };
    }];
}
export declare const IMPLICITLY_READ_SQL: AnsweredWhere;
