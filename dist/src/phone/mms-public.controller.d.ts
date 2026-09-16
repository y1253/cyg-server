import type { Response } from 'express';
export declare class MmsPublicController {
    serve(filename: string, token: string, range: string, res: Response): Promise<void>;
}
