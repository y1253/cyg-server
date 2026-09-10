import { Module } from '@nestjs/common';
import { SignatureImageController } from './signature-image.controller.js';
import { CompanySignatureImageController } from './company-signature-image.controller.js';
import { SignatureImagePublicController } from './signature-image-public.controller.js';
import { SignatureImageService } from './signature-image.service.js';

/**
 * The signature-logo library.
 *
 * THREE controllers on purpose, one per security posture — the split is the point rather
 * than an accident of file layout:
 *
 *   SignatureImageController        ADMIN, firm-wide library (except its widened GET)
 *   CompanySignatureImageController ADMIN+MANAGER, scoped to one company by its base path
 *   SignatureImagePublicController  no guard at all — a stranger's mail client fetches it
 *
 * See each class's docblock for why it may not be folded into another.
 */
@Module({
  controllers: [
    SignatureImageController,
    CompanySignatureImageController,
    SignatureImagePublicController,
  ],
  providers: [SignatureImageService],
  exports: [SignatureImageService],
})
export class SignatureImageModule {}
