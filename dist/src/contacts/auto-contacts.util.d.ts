export declare const AUTO_SOURCES: readonly ["OWNER", "STORE", "ACCOUNTANT"];
export type AutoSource = (typeof AUTO_SOURCES)[number];
export interface AutoContactSeed {
    autoSource: AutoSource;
    name: string;
    phone: string;
}
export interface AutoContactInput {
    contactInfo: {
        personalName: string | null;
        privatePhone: string | null;
        storeNumber: string | null;
    } | null;
    accountant: {
        name: string | null;
        phone: string | null;
    } | null;
}
export declare function desiredAutoContacts(input: AutoContactInput): AutoContactSeed[];
