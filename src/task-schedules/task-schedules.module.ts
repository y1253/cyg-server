import { Module } from '@nestjs/common';
import { TaskSchedulesService } from './task-schedules.service';
import { TaskSchedulesController } from './task-schedules.controller';

@Module({
  controllers: [TaskSchedulesController],
  providers: [TaskSchedulesService],
  exports: [TaskSchedulesService],
})
export class TaskSchedulesModule {}
