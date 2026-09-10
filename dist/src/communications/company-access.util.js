"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOwnCompany = isOwnCompany;
exports.assertOwnCompany = assertOwnCompany;
exports.listOwnCompanies = listOwnCompanies;
const common_1 = require("@nestjs/common");
async function isOwnCompany(prisma, companyId, userId) {
    const company = await prisma.company.findFirst({
        where: {
            id: companyId,
            deletedAt: null,
            OR: [{ internalOwnerId: userId }, { assignments: { some: { userId } } }],
        },
        select: { id: true },
    });
    return company !== null;
}
async function assertOwnCompany(prisma, companyId, userId) {
    if (!(await isOwnCompany(prisma, companyId, userId))) {
        throw new common_1.ForbiddenException('Not assigned to this company');
    }
}
async function listOwnCompanies(prisma, userId) {
    return prisma.company.findMany({
        where: {
            deletedAt: null,
            OR: [{ internalOwnerId: userId }, { assignments: { some: { userId } } }],
        },
        select: { id: true, businessName: true, isInternal: true },
    });
}
//# sourceMappingURL=company-access.util.js.map