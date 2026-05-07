import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Role } from '@prisma/client';
import { ScheduleNotesService } from './schedule-notes.service.js';
import { UpsertScheduleNoteDto } from './dto/upsert-schedule-note.dto.js';

@Controller('schedule-notes')
@UseGuards(JwtAuthGuard)
export class ScheduleNotesController {
  constructor(private readonly service: ScheduleNotesService) {}

  @Put(':scheduleId')
  upsert(
    @Param('scheduleId', ParseIntPipe) scheduleId: number,
    @Body() dto: UpsertScheduleNoteDto,
    @Request() req: { user: { userId: number } },
  ) {
    return this.service.upsert(scheduleId, req.user.userId, dto.note);
  }

  @Delete(':scheduleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('scheduleId', ParseIntPipe) scheduleId: number,
    @Request() req: { user: { userId: number } },
  ) {
    return this.service.remove(scheduleId, req.user.userId);
  }

  @Get(':scheduleId')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  findBySchedule(@Param('scheduleId', ParseIntPipe) scheduleId: number) {
    return this.service.findBySchedule(scheduleId);
  }
}
