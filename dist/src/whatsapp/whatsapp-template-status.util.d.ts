import type { TemplateStatus } from './whatsapp.util.js';
export interface StoredSubmission {
    id: number;
    metaTemplateId: string | null;
    name: string;
    language: string;
    status: string;
    rejectedReason: string | null;
}
export interface LiveTemplate {
    id: string | null;
    name: string;
    language: string;
    status: TemplateStatus;
    rejectedReason: string | null;
}
export interface StatusPatch {
    id: number;
    status: string;
    rejectedReason: string | null;
}
export declare function matchTemplate(row: StoredSubmission, live: readonly LiveTemplate[]): LiveTemplate | null;
export declare function reconcileSubmission(row: StoredSubmission, live: readonly LiveTemplate[]): StatusPatch | null;
export declare function reconcileSubmissions(rows: readonly StoredSubmission[], live: readonly LiveTemplate[]): StatusPatch[];
