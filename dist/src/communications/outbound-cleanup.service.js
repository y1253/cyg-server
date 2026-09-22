"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OutboundCleanupService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboundCleanupService = void 0;
const path = __importStar(require("path"));
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const outbound_uploads_js_1 = require("./outbound-uploads.js");
const mms_staging_util_js_1 = require("../phone/mms-staging.util.js");
const uploads_js_1 = require("../internal-messages/uploads.js");
const STAGING_STALE_MS = 6 * 60 * 60 * 1000;
let OutboundCleanupService = OutboundCleanupService_1 = class OutboundCleanupService {
    logger = new common_1.Logger(OutboundCleanupService_1.name);
    async sweep() {
        const removed = await (0, outbound_uploads_js_1.sweepStaleOutboundFiles)();
        if (removed > 0) {
            this.logger.log(`Removed ${removed} stale outbound attachment(s)`);
        }
        const mms = await (0, mms_staging_util_js_1.sweepStaleMmsFiles)();
        if (mms > 0) {
            this.logger.log(`Removed ${mms} stale MMS attachment(s)`);
        }
        const staged = await (0, outbound_uploads_js_1.sweepStaleFilesIn)(path.join(uploads_js_1.UPLOADS_ROOT, uploads_js_1.MESSAGES_STAGING_SUBDIR), STAGING_STALE_MS);
        if (staged > 0) {
            this.logger.log(`Removed ${staged} stale staged attachment(s)`);
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