import { ConfigService } from '@nestjs/config';
import type { EnhancedPhoto, RawPhoto } from './face-image.js';
export type UnenhancedPhoto = RawPhoto & {
    __enhanced?: never;
};
export interface LuxandVerifyResult {
    matched: boolean;
    probability: number | null;
}
export interface LuxandMatch {
    uuid: string;
    probability: number;
}
export interface LuxandLiveness {
    live: boolean;
    score: number | null;
}
export declare class LuxandService {
    private readonly logger;
    private readonly baseUrl;
    private readonly apiKey;
    private readonly searchMinConfidence;
    private readonly verifyMinConfidence;
    private readonly livenessMin;
    private readonly timeoutOverride;
    constructor(config: ConfigService);
    private call;
    private appendPhoto;
    createPerson(name: string, photos: EnhancedPhoto[]): Promise<string>;
    addPhoto(uuid: string, photo: EnhancedPhoto): Promise<void>;
    verify(uuid: string, photo: EnhancedPhoto): Promise<LuxandVerifyResult>;
    liveness(photo: UnenhancedPhoto): Promise<LuxandLiveness>;
    search(photo: EnhancedPhoto): Promise<LuxandMatch | null>;
    deletePerson(id: string): Promise<void>;
}
