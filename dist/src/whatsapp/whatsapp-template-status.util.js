"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchTemplate = matchTemplate;
exports.reconcileSubmission = reconcileSubmission;
exports.reconcileSubmissions = reconcileSubmissions;
function matchTemplate(row, live) {
    if (row.metaTemplateId) {
        const byId = live.find((t) => t.id === row.metaTemplateId);
        if (byId)
            return byId;
    }
    return (live.find((t) => t.name === row.name && t.language === row.language) ?? null);
}
function reconcileSubmission(row, live) {
    const match = matchTemplate(row, live);
    if (!match)
        return null;
    const rejectedReason = match.rejectedReason ?? null;
    if (match.status === row.status && rejectedReason === row.rejectedReason) {
        return null;
    }
    return { id: row.id, status: match.status, rejectedReason };
}
function reconcileSubmissions(rows, live) {
    return rows
        .map((row) => reconcileSubmission(row, live))
        .filter((patch) => patch !== null);
}
//# sourceMappingURL=whatsapp-template-status.util.js.map