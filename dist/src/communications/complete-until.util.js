"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idsUpTo = idsUpTo;
function byTime(a, b) {
    const at = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (at !== 0)
        return at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function idsUpTo(items, anchorId) {
    const ordered = [...items].sort(byTime);
    const index = ordered.findIndex((m) => m.id === anchorId);
    if (index === -1)
        return null;
    return ordered.slice(0, index + 1).map((m) => m.id);
}
//# sourceMappingURL=complete-until.util.js.map