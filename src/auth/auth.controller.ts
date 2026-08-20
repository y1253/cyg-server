import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { File as MulterFile } from 'multer';
import { memoryStorage } from 'multer';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto.email, dto.password);
  }

  @Post('face-login')
  // MulterExceptionFilter is registered globally (main.ts), so an oversize upload
  // comes back as a clean 400 rather than a stack trace.
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  // `faceBox` is the face rectangle the browser's detector already found, as
  // fractions of the frame. It stays a primitive @Body() param rather than a DTO
  // on purpose: main.ts runs ValidationPipe({ whitelist: true }), which would
  // silently strip an undecorated field, and the service treats a missing or
  // malformed box as "no crop" anyway.
  faceLogin(
    @Body('email') email: string,
    @Body('faceBox') faceBox: string | undefined,
    @UploadedFile() file: MulterFile,
  ) {
    if (!email) throw new BadRequestException('Email is required');
    if (!file) throw new BadRequestException('No photo provided');
    return this.authService.faceLogin(
      email,
      file.buffer,
      file.mimetype,
      faceBox,
    );
  }
}
