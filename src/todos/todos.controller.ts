import { Controller, Param, ParseIntPipe, Patch, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TodosService } from './todos.service.js';

@Controller('todos')
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Patch(':id/resolve')
  toggleResolve(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { userId: number; role: string } },
  ) {
    return this.todosService.toggleResolve(id, req.user.userId, req.user.role);
  }
}
