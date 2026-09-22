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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiDocumentService = void 0;
const common_1 = require("@nestjs/common");
const ai_service_js_1 = require("./ai.service.js");
const ai_config_js_1 = require("./ai.config.js");
const document_kind_util_js_1 = require("./document-kind.util.js");
const MAX_TEXT_CHARS = 20_000;
let AiDocumentService = class AiDocumentService {
    ai;
    constructor(ai) {
        this.ai = ai;
    }
    async summarize(input) {
        const decided = (0, document_kind_util_js_1.documentKind)(input.mimeType, input.filename);
        if ('refuse' in decided)
            throw new common_1.BadRequestException(decided.refuse);
        const model = (0, ai_config_js_1.visionModel)(process.env);
        const parts = this.partsFor(decided.kind, input);
        const summary = await this.ai.summarizeDocument(parts, model);
        return { summary };
    }
    partsFor(kind, input) {
        const ask = `Summarise this document: ${input.filename}`;
        if (kind === 'text') {
            const text = input.bytes.toString('utf8').slice(0, MAX_TEXT_CHARS);
            return [{ type: 'text', text: `${ask}\n\n"""\n${text}\n"""` }];
        }
        const dataUrl = `data:${input.mimeType};base64,${input.bytes.toString('base64')}`;
        if (kind === 'image') {
            return [
                { type: 'text', text: ask },
                { type: 'image_url', image_url: { url: dataUrl } },
            ];
        }
        return [
            { type: 'text', text: ask },
            {
                type: 'file',
                file: { filename: input.filename, file_data: dataUrl },
            },
        ];
    }
};
exports.AiDocumentService = AiDocumentService;
exports.AiDocumentService = AiDocumentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ai_service_js_1.AiService])
], AiDocumentService);
//# sourceMappingURL=ai-document.service.js.map