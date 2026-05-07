import { Module } from '@nestjs/common';
import { ScheduleNotesController } from './schedule-notes.controller.js';
import { ScheduleNotesService } from './schedule-notes.service.js';

@Module({
  controllers: [ScheduleNotesController],
  providers: [ScheduleNotesService],
})
export class ScheduleNotesModule {}
