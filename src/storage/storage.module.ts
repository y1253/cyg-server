import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service.js';

/**
 * `@Global`, mirroring `PrismaModule`, and for the same reason: four feature modules
 * (internal-messages, whatsapp, phone-audio, signature-image) all persist files, and this
 * is infrastructure of the same kind as the database connection rather than a feature.
 * Making it global is what keeps the storage swap from touching four unrelated module
 * files.
 */
@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}
