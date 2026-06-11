import { ConfigService } from '@nestjs/config';
export declare class LuxandService {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly minConfidence;
    constructor(config: ConfigService);
    private preprocessImage;
    enrollPerson(name: string, photo: Buffer, mimeType: string): Promise<string>;
    searchFace(photo: Buffer, mimeType: string, options?: {
        minConfidence?: number;
    }): Promise<{
        uuid: string;
        probability: number;
    } | null>;
    deletePerson(id: string): Promise<void>;
}
