import { ConfigService } from '@nestjs/config';
export interface PhotoInput {
    buffer: Buffer;
    mimeType?: string;
}
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
    private readonly preprocessLogin;
    constructor(config: ConfigService);
    private call;
    private preprocess;
    private appendPhoto;
    createPerson(name: string, photos: PhotoInput[]): Promise<string>;
    addPhoto(uuid: string, photo: PhotoInput): Promise<void>;
    verify(uuid: string, photo: PhotoInput): Promise<LuxandVerifyResult>;
    liveness(photo: PhotoInput): Promise<LuxandLiveness>;
    search(photo: PhotoInput): Promise<LuxandMatch | null>;
    deletePerson(id: string): Promise<void>;
}
