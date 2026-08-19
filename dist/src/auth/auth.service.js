"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const luxand_service_js_1 = require("../luxand/luxand.service.js");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const users_service_js_1 = require("../users/users.service.js");
const internal_workspace_js_1 = require("../companies/internal-workspace.js");
let AuthService = AuthService_1 = class AuthService {
    usersService;
    jwtService;
    config;
    luxand;
    prisma;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(usersService, jwtService, config, luxand, prisma) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.config = config;
        this.luxand = luxand;
        this.prisma = prisma;
    }
    async adminLogin(email, password) {
        const adminEmail = this.config.getOrThrow('ADMIN_EMAIL');
        const adminPassword = this.config.getOrThrow('ADMIN_PASSWORD');
        const adminName = this.config.get('ADMIN_NAME') ?? 'Admin';
        if (email !== adminEmail || password !== adminPassword) {
            throw new common_1.UnauthorizedException('Invalid credentials');
        }
        const admin = await this.prisma.user.upsert({
            where: { email: adminEmail },
            update: { deletedAt: null, role: client_1.Role.ADMIN },
            create: { name: adminName, email: adminEmail, role: client_1.Role.ADMIN },
        });
        await (0, internal_workspace_js_1.ensureInternalWorkspace)(this.prisma, admin.id);
        const payload = {
            sub: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
        };
        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: admin.id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
            },
        };
    }
    async faceLogin(email, photo, mimeType) {
        const started = Date.now();
        const user = await this.usersService.findByEmail(email);
        if (!user)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const subjectId = user.faceSubject?.subjectId;
        if (!subjectId) {
            throw new common_1.UnauthorizedException('Face not enrolled for this account');
        }
        const input = { buffer: photo, mimeType };
        const mode = this.config.get('LUXAND_LOGIN_MODE') ?? 'verify';
        const livenessEnabled = this.config.get('LUXAND_LIVENESS') !== '0';
        const [identity, live] = await Promise.all([
            mode === 'search'
                ? this.luxand.search(input).then((m) => ({
                    matched: m?.uuid === subjectId,
                    probability: m?.probability ?? null,
                }))
                : this.luxand.verify(subjectId, input),
            livenessEnabled
                ? this.luxand.liveness(input)
                : Promise.resolve({ live: true, score: null }),
        ]);
        this.logger.log(`faceLogin ${email} ${identity.matched ? 'MATCH' : 'REJECT'} mode=${mode} ` +
            `prob=${identity.probability ?? '-'} live=${live.score ?? '-'} ` +
            `total=${Date.now() - started}ms`);
        if (!live.live || !identity.matched) {
            throw new common_1.UnauthorizedException('Face not recognized');
        }
        const payload = {
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        };
        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_js_1.UsersService,
        jwt_1.JwtService,
        config_1.ConfigService,
        luxand_service_js_1.LuxandService,
        prisma_service_js_1.PrismaService])
], AuthService);
//# sourceMappingURL=auth.service.js.map