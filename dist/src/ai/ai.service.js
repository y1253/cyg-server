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
const TIMEOUTS = {
    chat: 60_000,
    transcribe: 300_000,
};
let AiService = class AiService {
    chatUrl = 'https://api.openai.com/v1/chat/completions';
    transcribeUrl = 'https://api.openai.com/v1/audio/transcriptions';
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
        const polished = await this.chat({
            model: this.model,
            system,
            user,
            maxTokens: 800,
            failure: 'The AI service failed to polish the reply.',
        });
        return { polished };
    }
    async transcribeAudio(audio, filename, mimeType = 'audio/mpeg') {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
        form.append('model', this.transcribeModelId);
        form.append('response_format', 'json');
        let res;
        try {
            res = await fetch(this.transcribeUrl, {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.apiKey}` },
                body: form,
                signal: AbortSignal.timeout(TIMEOUTS.transcribe),
            });
        }
        catch {
            throw new common_1.BadGatewayException('Could not reach the AI service.');
        }
        const data = (await res.json().catch(() => ({})));
        if (!res.ok) {
            throw new common_1.BadGatewayException(data.error?.message ?? 'The AI service failed to transcribe the audio.');
        }
        return (data.text ?? '').trim();
    }
    async summarizeCall(transcript, model) {
        const system = 'You summarise transcripts of business phone calls at a bookkeeping and ' +
            'accountancy firm. Write 2 to 4 sentences covering: why the caller called, ' +
            'what was decided, and any follow-up owed and by whom. ' +
            'ALWAYS write in English, even when the call was conducted in another ' +
            'language. State only what the transcript supports — never guess at names, ' +
            'amounts, dates or outcomes that were not said. Transcription is imperfect; ' +
            'if the transcript is too garbled or too short to be meaningful, say exactly ' +
            'that in one sentence instead of inventing content. Return ONLY the summary ' +
            'text — no preamble, heading, bullet points or quotes.';
        const user = `Call transcript:\n"""\n${transcript}\n"""\n\nSummarise this call.`;
        return this.chat({
            model,
            system,
            user,
            maxTokens: 300,
            failure: 'The AI service failed to summarise the call.',
        });
    }
    get transcribeModelId() {
        const raw = (process.env.OPENAI_TRANSCRIBE_MODEL ?? '').trim();
        return raw !== '' ? raw : 'whisper-1';
    }
    async chat(input) {
        let res;
        try {
            res = await fetch(this.chatUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: input.model,
                    temperature: 0.4,
                    max_tokens: input.maxTokens,
                    messages: [
                        { role: 'system', content: input.system },
                        { role: 'user', content: input.user },
                    ],
                }),
                signal: AbortSignal.timeout(TIMEOUTS.chat),
            });
        }
        catch {
            throw new common_1.BadGatewayException('Could not reach the AI service.');
        }
        const data = (await res.json().catch(() => ({})));
        if (!res.ok) {
            throw new common_1.BadGatewayException(data.error?.message ?? input.failure);
        }
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new common_1.BadGatewayException('The AI service returned an empty reply.');
        }
        return content;
    }
};
exports.AiService = AiService;
exports.AiService = AiService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AiService);
//# sourceMappingURL=ai.service.js.map