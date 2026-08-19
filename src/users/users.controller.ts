import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { File as MulterFile } from 'multer';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('roles')
  getRoles() {
    return this.usersService.getRoles();
  }

  /**
   * Staff directory for the internal-messaging recipient autocomplete.
   *
   * JWT-only, like `roles` above — regular users must be able to address a message
   * to a colleague, and `GET /users` is ADMIN-gated. Returns only id/name/email
   * (no roles, no face-enrolment state) and excludes the caller, who cannot be a
   * recipient of their own message.
   */
  @Get('directory')
  directory(@Request() req: { user: { userId: number } }) {
    return this.usersService.findDirectory(req.user.userId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }

  @Post(':id/enroll-face')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FilesInterceptor('photos', 3, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: 3 },
    }),
  )
  enrollFace(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: MulterFile[],
  ) {
    if (!files || files.length !== 3)
      throw new BadRequestException('Exactly 3 photos required');
    return this.usersService.enrollFace(
      id,
      files.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype })),
    );
  }
}
