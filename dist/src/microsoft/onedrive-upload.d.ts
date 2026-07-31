import type { SharedLink } from '../communications/link-attachments.util.js';
import type { OutboundFile } from '../communications/outbound-uploads.js';
export declare function grantsOneDriveUpload(scope: string | null | undefined): boolean;
export declare function uploadAllToOneDrive(token: string, files: OutboundFile[]): Promise<SharedLink[]>;
