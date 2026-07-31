import { type drive_v3 } from 'googleapis';
import type { SharedLink } from '../communications/link-attachments.util.js';
export declare function grantsDriveUpload(scope: string | null | undefined): boolean;
type DriveAuth = NonNullable<drive_v3.Options['auth']>;
export declare function makeDriveClient(auth: DriveAuth): drive_v3.Drive;
export declare function uploadAndShare(drive: drive_v3.Drive, folderId: string, file: {
    originalname: string;
    mimetype: string;
    size: number;
    path: string;
}): Promise<SharedLink>;
export declare function uploadAllToDrive(drive: drive_v3.Drive, files: Array<{
    originalname: string;
    mimetype: string;
    size: number;
    path: string;
}>): Promise<SharedLink[]>;
export {};
