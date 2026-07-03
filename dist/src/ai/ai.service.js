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
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let AiService = class AiService {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    apiKey;
    model;
    constructor(config) {
        this.apiKey = config.getOrThrow('OPENAI_API_KEY');
        this.model = config.get('OPENAI_POLISH_MODEL') ?? 'gpt-4o-mini';
    }
    async polishReply(dto) {
        const isEmail = dto.kind === 'email';
        const medium = isEmail ? 'email' : 'chat message';
        const system = 'You polish a draft reply to make it more professional, clear and ' +
            'well-written while preserving the original meaning, intent, facts and ' +
            "figures. Do not invent new information or answer on the sender's behalf " +
            'beyond what the draft says. Use tone appropriate to the medium (formal ' +
            'for email, concise and friendly for chat). Return ONLY the polished ' +
            'reply text — no preamble, quotes, subject line, or explanation.';
        const user = `This is the ${medium} conversation for context:\n` +
            `"""\n${dto.context}\n"""\n\n` +
            `This is my draft reply:\n"""\n${dto.draft}\n"""\n\n` +
            `Polish my draft reply for this ${medium}.`;
        let res;
        try {
            res = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    temperature: 0.4,
                    max_tokens: 800,
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                    ],
                }),
            });
        }
        catch {
            throw new common_1.BadGatewayException('Could not reach the AI service.');
        }
        const data = (await res.json().catch(() => ({})));
        if (!res.ok) {
            throw new common_1.BadGatewayException(data.error?.message ?? 'The AI service failed to polish the reply.');
        }
        const polished = data.choices?.[0]?.message?.content?.trim();
        if (!polished) {
            throw new common_1.BadGatewayException('The AI service returned an empty reply.');
        }
        return { polished };
    }
};
exports.AiService = AiService;
exports.AiService = AiService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AiService);
//# sourceMappingURL=ai.service.js.map