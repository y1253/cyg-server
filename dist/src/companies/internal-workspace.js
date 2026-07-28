"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTERNAL_WORKSPACE_NAME = void 0;
exports.ensureInternalWorkspace = ensureInternalWorkspace;
exports.INTERNAL_WORKSPACE_NAME = 'Cyg Finance';
async function ensureInternalWorkspace(db, userId) {
    return db.company.upsert({
        where: { internalOwnerId: userId },
        update: { deletedAt: null },
        create: {
            businessName: exports.INTERNAL_WORKSPACE_NAME,
            isInternal: true,
            internalOwnerId: userId,
        },
    });
}
//# sourceMappingURL=internal-workspace.js.map