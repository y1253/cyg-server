import { Module } from '@nestjs/common';
import { SignatureImageModule } from '../signature-image/signature-image.module.js';
import { EmailSignatureController } from './email-signature.controller.js';
import { EmailSignatureService } from './email-signature.service.js';

/**
 * Email signature settings: one global default, per-company overrides.
 *
 * Its own module rather than a controller bolted onto Gmail or Microsoft, because it is
 * provider-agnostic by definition — both provider services import it purely to answer
 * `getAccount`, and the dependency runs ONE WAY. Nothing here knows about either provider,
 * so there is no cycle.
 */
@Module({
  imports: [SignatureImageModule],
  controllers: [EmailSignatureController],
  providers: [EmailSignatureService],
  exports: [EmailSignatureService],
})
export class EmailSignatureModule {}
