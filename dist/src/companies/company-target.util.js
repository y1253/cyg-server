"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertRealCompany = assertRealCompany;
const common_1 = require("@nestjs/common");
async function assertRealCompany(prisma, companyId, internalMessage) {
    const company = await prisma.company.findFirst({
        where: { id: companyId, deletedAt: null },
        select: { id: true, businessName: true, isInternal: true },
    });
    if (!company)
        throw new common_1.NotFoundException('Company not found');
    if (company.isInternal)
        throw new common_1.BadRequestException(internalMessage);
    return company;
}
//# sourceMappingURL=company-target.util.js.map