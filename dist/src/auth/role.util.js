"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isManagement = isManagement;
const client_1 = require("@prisma/client");
function isManagement(role) {
    return role === client_1.Role.ADMIN || role === client_1.Role.MANAGER;
}
//# sourceMappingURL=role.util.js.map