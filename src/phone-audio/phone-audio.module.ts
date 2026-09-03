import { Module } from '@nestjs/common';
import { PhoneAudioController } from './phone-audio.controller.js';
import { PhoneAudioService } from './phone-audio.service.js';

/**
 * Its own module rather than more surface on PhoneModule, which already carries two
 * controllers and six services under a deliberate separation rule.
 *
 * Exports the service so PhoneModule can stream a track and resolve the one a company
 * uses on hold. PrismaModule is global, so nothing needs importing here.
 */
@Module({
  controllers: [PhoneAudioController],
  providers: [PhoneAudioService],
  exports: [PhoneAudioService],
})
export class PhoneAudioModule {}
