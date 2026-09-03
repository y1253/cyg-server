import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { PhoneAudioService } from './phone-audio.service.js';
import {
  audioFileFilter,
  PHONE_AUDIO_MULTER_LIMITS,
  phoneAudioStorage,
} from './phone-audio.storage.js';

type AuthedRequest = { user: { userId: number; role: string } };

interface UploadedAudio {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Managing the hold-music library. ADMIN only, at the class level.
 *
 * The route that STREAMS the bytes deliberately lives on PhoneController instead
 * (/api/phone/audio/:id), because it has to be unguarded to work as an audio element's
 * src. Mixing a guarded class with one unguarded route is how an unguarded route
 * eventually gets added by accident -- the same reason PhoneWebhooksController is a
 * separate class from PhoneController.
 */
@Controller('phone-audio')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PhoneAudioController {
  constructor(private readonly service: PhoneAudioService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: phoneAudioStorage,
      limits: PHONE_AUDIO_MULTER_LIMITS,
      fileFilter: audioFileFilter,
    }),
  )
  upload(
    @Request() req: AuthedRequest,
    @UploadedFile() file: UploadedAudio | undefined,
    @Body('name') name?: string,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded');
    return this.service.create(file, name, req.user.userId);
  }

  @Patch(':id')
  rename(@Param('id', ParseIntPipe) id: number, @Body('name') name?: string) {
    return this.service.rename(id, name ?? '');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
  }
}
