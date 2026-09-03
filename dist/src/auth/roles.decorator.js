"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGEMENT_ROLES = exports.Roles = exports.ROLES_KEY = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
exports.ROLES_KEY = 'roles';
const Roles = (...roles) => (0, common_1.SetMetadata)(exports.ROLES_KEY, roles);
exports.Roles = Roles;
exports.MANAGEMENT_ROLES = [client_1.Role.ADMIN, client_1.Role.MANAGER];
//# sourceMappingURL=roles.decorator.js.map