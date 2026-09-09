import { Module } from '@nestjs/common';
import { SignatureImageController } from './signature-image.controller.js';
import { SignatureImagePublicController } from './signature-image-public.controller.js';
import { SignatureImageService } from './signature-image.service.js';

/**
 * The signature-logo library.
 *
 * Two controllers on purpose: one fully guarded, one fully public. See
 * `SignatureImagePublicController` for why the split is the point rather than an accident
 * of file layout.
 */
@Module({
  controllers: [SignatureImageController, SignatureImagePublicController],
  providers: [SignatureImageService],
  exports: [SignatureImageService],
})
export class SignatureImageModule {}
