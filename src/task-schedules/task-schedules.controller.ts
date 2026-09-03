import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TaskSchedulesService } from './task-schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { UpdateScheduleUserNoteDto } from './dto/update-schedule-user-note.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('task-schedules')
export class TaskSchedulesController {
  constructor(private readonly service: TaskSchedulesService) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  create(@Body() dto: CreateScheduleDto) {
    return this.service.create(dto);
  }

  @Get()
  findByCompany(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.service.findByCompany(companyId);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.service.update(id, dto);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id/toggle')
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.service.toggle(id);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id/toggle-important')
  toggleImportant(@Param('id', ParseIntPipe) id: number) {
    return this.service.toggleImportant(id);
  }

  @Patch(':id/user-note')
  updateUserNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateScheduleUserNoteDto,
  ) {
    return this.service.updateUserNote(id, body.note);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSchedule(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteSchedule(id);
  }
}
