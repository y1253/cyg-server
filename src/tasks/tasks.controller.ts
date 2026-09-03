import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TasksService } from './tasks.service.js';
import { AssignTaskDto } from './dto/assign-task.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

/**
 * The task-template library.
 *
 * Editing templates is one of the two things a MANAGER deliberately cannot do
 * (`/admin/tasks` is hidden from them), so the write routes stay ADMIN-only.
 * `GET /tasks` is the exception and must NOT be folded back into a class-level
 * gate: the per-company Schedules tab's AddTaskDialog reads it to populate its
 * task picker, and managers keep that tab.
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @Roles(...MANAGEMENT_ROLES)
  findAll() {
    return this.tasksService.findAll();
  }

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.remove(id);
  }

  @Post(':id/assign')
  assignToCompany(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasksService.assignToCompany(id, dto);
  }
}
