import { Module } from '@nestjs/common';
import { FaceEnhancerService } from './face-enhancer.service.js';
import { LuxandService } from './luxand.service.js';

@Module({
  providers: [LuxandService, FaceEnhancerService],
  exports: [LuxandService, FaceEnhancerService],
})
export class LuxandModule {}
