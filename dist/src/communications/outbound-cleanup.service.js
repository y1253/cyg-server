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
var OutboundCleanupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboundCleanupService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const outbound_uploads_js_1 = require("./outbound-uploads.js");
let OutboundCleanupService = OutboundCleanupService_1 = class OutboundCleanupService {
    logger = new common_1.Logger(OutboundCleanupService_1.name);
    async sweep() {
        const removed = await (0, outbound_uploads_js_1.sweepStaleOutboundFiles)();
        if (removed > 0) {
            this.logger.log(`Removed ${removed} stale outbound attachment(s)`);
        }
    }
};
exports.OutboundCleanupService = OutboundCleanupService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_HOUR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OutboundCleanupService.prototype, "sweep", null);
exports.OutboundCleanupService = OutboundCleanupService = OutboundCleanupService_1 = __decorate([
    (0, common_1.Injectable)()
], OutboundCleanupService);
//# sourceMappingURL=outbound-cleanup.service.js.map