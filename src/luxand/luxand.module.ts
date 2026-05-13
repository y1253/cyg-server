import { Module } from '@nestjs/common';
import { LuxandService } from './luxand.service.js';

@Module({
  providers: [LuxandService],
  exports: [LuxandService],
})
export class LuxandModule {}
