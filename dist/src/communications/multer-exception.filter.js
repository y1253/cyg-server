"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MulterExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MulterExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const multer_1 = require("multer");
const outbound_uploads_js_1 = require("./outbound-uploads.js");
let MulterExceptionFilter = MulterExceptionFilter_1 = class MulterExceptionFilter {
    logger = new common_1.Logger(MulterExceptionFilter_1.name);
    catch(err, host) {
        const res = host.switchToHttp().getResponse();
        const mb = (bytes) => Math.round(bytes / (1024 * 1024));
        let message;
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = `That attachment is over the ${mb(outbound_uploads_js_1.MAX_OUTBOUND_FILE_BYTES)} MB limit for a single file.`;
                break;
            case 'LIMIT_FILE_COUNT':
            case 'LIMIT_UNEXPECTED_FILE':
                message = 'That file was not accepted. Please attach it again.';
                break;
            case 'LIMIT_FIELD_VALUE':
                message =
                    'This message is too long to send — try forwarding fewer messages of ' +
                        'the conversation, or removing large images from the quoted text.';
                break;
            default:
                message = 'The message could not be uploaded. Please try again.';
        }
        this.logger.warn(`multer ${err.code} on ${host.switchToHttp().getRequest().url}`);
        res.status(common_1.HttpStatus.BAD_REQUEST).json({
            statusCode: common_1.HttpStatus.BAD_REQUEST,
            message,
            error: 'Bad Request',
        });
    }
};
exports.MulterExceptionFilter = MulterExceptionFilter;
exports.MulterExceptionFilter = MulterExceptionFilter = MulterExceptionFilter_1 = __decorate([
    (0, common_1.Catch)(multer_1.MulterError)
], MulterExceptionFilter);
//# sourceMappingURL=multer-exception.filter.js.map