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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var FaceEnhancerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FaceEnhancerService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const sharp_1 = __importDefault(require("sharp"));
const face_image_js_1 = require("./face-image.js");
let FaceEnhancerService = FaceEnhancerService_1 = class FaceEnhancerService {
    logger = new common_1.Logger(FaceEnhancerService_1.name);
    enabled;
    cropEnabled;
    constructor(config) {
        this.enabled = config.get('LUXAND_ENHANCE') !== '0';
        this.cropEnabled = config.get('LUXAND_ENHANCE_CROP') !== '0';
    }
    passthrough(photo) {
        return brand(photo);
    }
    async enhance(photo, box, mode) {
        if (!this.enabled)
            return brand(photo);
        const started = Date.now();
        try {
            const result = await this.run(photo, box, mode);
            this.logger.log(`face-enhance ${mode} box=${result.cropped ? 'y' : 'n'} ` +
                `${photo.buffer.length}->${result.photo.buffer.length}B ${Date.now() - started}ms`);
            this.logger.debug(`face-enhance ${mode} ${result.detail}`);
            return result.photo;
        }
        catch (err) {
            this.logger.warn(`face-enhance ${mode} FAILED after ${Date.now() - started}ms, sending original: ${String(err)}`);
            return brand(photo);
        }
    }
    async run(photo, box, mode) {
        const { width, height } = await displaySize(photo.buffer);
        const rect = box && this.cropEnabled ? (0, face_image_js_1.cropRect)(box, width, height) : null;
        let pass1 = (0, sharp_1.default)(photo.buffer, { failOn: 'none' }).rotate();
        let upscaled = false;
        if (rect) {
            const target = (0, face_image_js_1.targetSide)(rect.width);
            upscaled = target.upscaled;
            pass1 = pass1.extract(rect).resize({
                width: target.side,
                height: target.side,
                kernel: (0, face_image_js_1.resizeKernel)(target.upscaled),
                fit: 'fill',
            });
        }
        else {
            const shrink = (0, face_image_js_1.noBoxResize)(width, height);
            if (shrink) {
                pass1 = pass1.resize({ ...shrink, kernel: 'lanczos3', fit: 'fill' });
            }
        }
        const { data, info } = await pass1
            .toColorspace('srgb')
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const stats = (0, face_image_js_1.lumaStats)(data, info.width, info.height, info.channels, rect ? 'all' : 'center');
        const tone = (0, face_image_js_1.toneAdjustment)(stats);
        const denoise = (0, face_image_js_1.needsDenoise)(stats, tone);
        const sharpen = (0, face_image_js_1.sharpenParams)(upscaled);
        let pass2 = (0, sharp_1.default)(data, {
            raw: { width: info.width, height: info.height, channels: info.channels },
        });
        if (tone)
            pass2 = pass2.linear(tone.a, tone.b);
        if (denoise)
            pass2 = pass2.median(3);
        const buffer = await pass2
            .sharpen(sharpen)
            .jpeg({
            quality: (0, face_image_js_1.jpegQuality)(mode),
            chromaSubsampling: '4:4:4',
            mozjpeg: false,
        })
            .toBuffer();
        return {
            photo: brand({ buffer, mimeType: 'image/jpeg' }),
            cropped: rect !== null,
            detail: describe(rect, info.width, stats, tone, denoise, upscaled),
        };
    }
};
exports.FaceEnhancerService = FaceEnhancerService;
exports.FaceEnhancerService = FaceEnhancerService = FaceEnhancerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], FaceEnhancerService);
function brand(photo) {
    return { buffer: photo.buffer, mimeType: photo.mimeType };
}
async function displaySize(buffer) {
    const meta = await (0, sharp_1.default)(buffer, { failOn: 'none' }).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const swapped = (meta.orientation ?? 1) >= 5;
    return swapped ? { width: height, height: width } : { width, height };
}
function describe(rect, side, stats, tone, denoise, upscaled) {
    const crop = rect ? `${rect.width}px@${rect.left},${rect.top}` : 'none';
    const curve = tone ? `a=${tone.a.toFixed(2)} b=${tone.b.toFixed(1)}` : 'none';
    return (`crop=${crop} side=${side} up=${upscaled ? 'y' : 'n'} ` +
        `mean=${stats.mean.toFixed(1)} stdev=${stats.stdev.toFixed(1)} ` +
        `tone=${curve} denoise=${denoise ? 'y' : 'n'}`);
}
//# sourceMappingURL=face-enhancer.service.js.map