import { Module } from '@nestjs/common';
import { LinksController } from './links.controller.js';
import { LinksService } from './links.service.js';

@Module({
  controllers: [LinksController],
  providers: [LinksService],
})
export class LinksModule {}
