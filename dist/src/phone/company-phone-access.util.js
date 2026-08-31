"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertMayUseCompanyPhone = assertMayUseCompanyPhone;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const logger = new common_1.Logger('CompanyPhoneAccess');
async function assertMayUseCompanyPhone(prisma, assignments, userId, companyName, action) {
    if (assignments.some((a) => a.userId === userId))
        return;
    const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { role: true },
    });
    if (user?.role === client_1.Role.ADMIN)
        return;
    logger.warn(`user ${userId} tried to ${action} for ${companyName} without an assignment`);
    throw new common_1.ForbiddenException('Not assigned to this company');
}
//# sourceMappingURL=company-phone-access.util.js.map