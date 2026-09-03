import { PhoneAudioService } from './phone-audio.service.js';
type AuthedRequest = {
    user: {
        userId: number;
        role: string;
    };
};
interface UploadedAudio {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
}
export declare class PhoneAudioController {
    private readonly service;
    constructor(service: PhoneAudioService);
    list(): Promise<import("./phone-audio.service.js").PhoneAudioView[]>;
    upload(req: AuthedRequest, file: UploadedAudio | undefined, name?: string): Promise<import("./phone-audio.service.js").PhoneAudioView>;
    rename(id: number, name?: string): Promise<import("./phone-audio.service.js").PhoneAudioView>;
    remove(id: number): Promise<void>;
}
export {};
