import { ConfigService } from '@nestjs/config';
import { type EnhancedPhoto, type NormalizedBox, type PhotoMode, type RawPhoto } from './face-image.js';
export declare class FaceEnhancerService {
    private readonly logger;
    private readonly enabled;
    private readonly cropEnabled;
    constructor(config: ConfigService);
    passthrough(photo: RawPhoto): EnhancedPhoto;
    enhance(photo: RawPhoto, box: NormalizedBox | null, mode: PhotoMode): Promise<EnhancedPhoto>;
    private run;
}
