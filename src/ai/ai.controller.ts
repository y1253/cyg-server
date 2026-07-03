import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AiService } from './ai.service.js';
import { PolishReplyDto } from './dto/polish-reply.dto.js';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // Polish a draft reply (email or chat) with the AI. Any authenticated user —
  // mirrors reply/send, which is not admin-gated.
  @Post('polish-reply')
  @UseGuards(JwtAuthGuard)
  polishReply(@Body() dto: PolishReplyDto) {
    return this.aiService.polishReply(dto);
  }
}
