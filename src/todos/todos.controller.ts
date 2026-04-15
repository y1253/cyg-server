import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Role } from '@prisma/client';
import { TodosService } from './todos.service.js';
import { SetCycleDto } from './dto/set-cycle.dto.js';

@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  // Any authenticated user can toggle resolve (non-admin checked inside service)
  @UseGuards(JwtAuthGuard)
  @Patch(':id/resolve')
  toggleResolve(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { userId: number; role: string } },
  ) {
    return this.todosService.toggleResolve(id, req.user.userId, req.user.role);
  }

  // Admin-only actions
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.todosService.remove(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/set-cycle')
  setCycle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCycleDto,
  ) {
    return this.todosService.setCycle(id, dto.cycle);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/remove-cycle')
  removeCycle(@Param('id', ParseIntPipe) id: number) {
    return this.todosService.removeCycle(id);
  }
}
