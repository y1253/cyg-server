import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AiService } from './ai.service.js';
import { PolishReplyDto } from './dto/polish-reply.dto.js';
import { TranslateDto } from './dto/translate.dto.js';
import {
  aiAssist,
  aiTranscribeInbound,
  summaryOrPolishModel,
} from './ai.config.js';
import {
  MAX_TRANSCRIBE_BYTES,
  transcribeFileFilter,
} from './transcribe-upload.js';

/**
 * The channel-agnostic AI routes.
 *
 * ── WHAT BELONGS HERE, AND WHAT DOES NOT ──────────────────────────────────────
 * The rule this codebase already follows (see `POST /whatsapp/companies/:id/templates/
 * generate`, which is on the WhatsApp controller with that module's own guard): an AI
 * route that NAMES A COMPANY lives on that company's controller, where the ownership
 * proof already is. `AiController` holds only the routes whose input the user already
 * has in their hand -- their own draft, their own microphone, text already on their
 * screen -- so nothing company-owned crosses them and `JwtAuthGuard` is the right tier.
 */
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * What is switched on, so the UI can HIDE what it cannot do.
   *
   * ⚠️ This route is the lesson from voicemail, which "shipped switched off, with no
   * switch" and was therefore unreachable. A client that cannot read the flags would
   * render buttons that 403, which is worse than not rendering them: the user cannot tell
   * a broken feature from one the firm has chosen not to pay for.
   */
  @Get('config')
  @UseGuards(JwtAuthGuard)
  config(): { assist: boolean; transcribeInbound: boolean } {
    return {
      assist: aiAssist(process.env),
      transcribeInbound: aiTranscribeInbound(process.env),
    };
  }

  /**
   * Polish a draft reply with the AI. Any authenticated user -- mirrors reply/send,
   * which is not admin-gated.
   *
   * ⚠️ The `aiAssist` check was MISSING here until polish was extended to SMS and
   * WhatsApp. Polish predates the flag, so with `AI_ASSIST=0` every other AI control
   * disappeared from the composer while "Polish with AI" stayed visible and kept
   * spending -- and in the text composers the two buttons sit side by side, which is
   * where that stopped being invisible. `PolishButton` now hides on the same flag, and
   * this is the server half of that agreement.
   */
  @Post('polish-reply')
  @UseGuards(JwtAuthGuard)
  polishReply(@Body() dto: PolishReplyDto) {
    if (!aiAssist(process.env)) {
      throw new BadRequestException('AI assistance is switched off.');
    }
    return this.aiService.polishReply(dto);
  }

  /**
   * Dictation: the user's own voice, into text, for any composer.
   *
   * ONE route rather than one per channel. The audio is the user's own microphone and
   * carries nothing company-owned, so there is nothing per-channel to authorise -- and
   * five copies of a multer config is how five copies drift.
   *
   * ⚠️ The browser's container goes straight through with no ffmpeg pass.
   * `recordingFilename` always supplies an extension matching the container
   * `pickRecorderMime` chose, and webm/ogg/mp4 are all accepted formats --
   * `transcribeAudio`'s documented failure mode is an EXTENSIONLESS part, which cannot
   * happen here. Re-encoding every dictation to guard against a case that does not arise
   * would be an ffmpeg spawn per sentence.
   */
  @Post('transcribe')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_TRANSCRIBE_BYTES, files: 1 },
      fileFilter: transcribeFileFilter,
    }),
  )
  async transcribe(
    @UploadedFile()
    file?: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
    },
  ): Promise<{ text: string }> {
    if (!aiAssist(process.env)) {
      throw new BadRequestException('AI assistance is switched off.');
    }
    if (!file) throw new BadRequestException('No recording was uploaded.');
    const text = await this.aiService.transcribeAudio(
      file.buffer,
      file.originalname || 'dictation.webm',
      file.mimetype,
    );
    return { text };
  }

  /**
   * A received message, in English.
   *
   * The TEXT is posted rather than an id, because the client already has it on screen --
   * having the server re-fetch a message it was just shown would add an auth surface to
   * read something the caller is demonstrably already reading.
   */
  @Post('translate')
  @UseGuards(JwtAuthGuard)
  async translate(@Body() dto: TranslateDto): Promise<{ translated: string }> {
    if (!aiAssist(process.env)) {
      throw new BadRequestException('AI assistance is switched off.');
    }
    const translated = await this.aiService.translateToEnglish(
      dto.text,
      summaryOrPolishModel(process.env),
    );
    return { translated };
  }
}
