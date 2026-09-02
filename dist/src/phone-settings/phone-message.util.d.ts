export declare const PLACEHOLDERS: readonly [{
    readonly token: "{company name}";
    readonly label: "Company name";
    readonly key: "company";
    readonly example: "Acme Bookkeeping";
}, {
    readonly token: "{phone}";
    readonly label: "Support number";
    readonly key: "phone";
    readonly example: "+1 438 256 1210";
}, {
    readonly token: "{hours}";
    readonly label: "Today's hours";
    readonly key: "hours";
    readonly example: "9 AM to 5 PM";
}];
export interface MessageVars {
    company: string;
    phone: string;
    hours: string;
}
export declare function renderMessage(template: string, vars: MessageVars): string;
