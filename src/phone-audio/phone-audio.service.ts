import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { newAudioStoragePath } from './phone-audio.storage.js';
import { audioIdOrNone, transcodeToTelephonyMp3 } from './phone-audio.util.js';

export interface PhoneAudioView {
  id: number;
  name: string;
  filename: string;
  size: number;
  durationMs: number;
  createdAt: Date;
}

interface UploadedAudio {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class PhoneAudioService {
  private readonly logger = new Logger(PhoneAudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  async list(): Promise<PhoneAudioView[]> {
    const rows = await this.prisma.phoneAudio.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * Transcode, store the bytes, then record the row -- in that order.
   *
   * The row is created LAST, once the bytes are safely in the bucket, so a failed transcode
   * or a failed upload leaves no row pointing at an object that does not exist. The reverse
   * ordering would make a track look available and fail while a caller is already on hold,
   * which is the worst possible moment to find out.
   */
  async create(
    file: UploadedAudio,
    name: string | undefined,
    uploadedById: number,
  ): Promise<PhoneAudioView> {
    let mp3: Buffer;
    let durationMs: number;
    try {
      ({ mp3, durationMs } = await transcodeToTelephonyMp3(file.buffer));
    } catch (err) {
      // The mimetype filter is advisory; ffmpeg is what actually decides whether these
      // bytes are audio. Its stderr means nothing to an admin, so it goes to the log and
      // they get a sentence they can act on.
      this.logger.warn(
        `phone-audio transcode failed for "${file.originalname}": ${String(err)}`,
      );
      throw new BadRequestException(
        'That file could not be read as audio. Try an MP3 or WAV.',
      );
    }

    // `storagePath` is the object key; nothing about the host goes into the column.
    const storagePath = newAudioStoragePath();
    await this.storage.putBuffer(storagePath, mp3, 'audio/mpeg');

    const row = await this.prisma.phoneAudio.create({
      data: {
        name: (name ?? '').trim() || this.defaultName(file.originalname),
        filename: file.originalname,
        mimeType: 'audio/mpeg',
        size: mp3.length,
        durationMs,
        storagePath,
        uploadedById,
      },
    });
    this.logger.log(
      `phone-audio uploaded id=${row.id} "${row.name}" ${mp3.length}B ${durationMs}ms`,
    );
    return this.toView(row);
  }

  async rename(id: number, name: string): Promise<PhoneAudioView> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name cannot be empty');
    await this.getOrThrow(id);
    const row = await this.prisma.phoneAudio.update({
      where: { id },
      data: { name: trimmed },
    });
    return this.toView(row);
  }

  /**
   * Soft delete. The row stays because settings rows name this id with no FK to protect
   * them -- a hard delete would leave a company pointing at nothing, with nothing able to
   * report it.
   */
  async remove(id: number): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.phoneAudio.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The track behind a settings value, or null for none / missing / soft-deleted.
   *
   * Never throws: this runs while a caller is being put on hold, and silence there is a far
   * better outcome than an exception.
   */
  async resolve(settingValue: number | null | undefined) {
    const id = audioIdOrNone(settingValue);
    if (id === null) return null;
    const row = await this.prisma.phoneAudio.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      // Logged because it means a settings row outlived its track -- a mistake somebody
      // should be able to find, even though the call itself carries on fine.
      this.logger.warn(
        `phone-audio id=${id} is referenced by settings but unavailable`,
      );
      return null;
    }
    return row;
  }

  async streamable(id: number) {
    const row = await this.getOrThrow(id);
    // `storagePath` IS the object key — `phone-audio/<uuid>.mp3`.
    return {
      storageKey: row.storagePath,
      mimeType: row.mimeType,
      filename: `${row.name}.mp3`,
    };
  }

  private async getOrThrow(id: number) {
    const row = await this.prisma.phoneAudio.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Audio not found');
    return row;
  }

  private defaultName(originalname: string): string {
    const base = path.basename(originalname, path.extname(originalname)).trim();
    return base.slice(0, 80) || 'Untitled';
  }

  private toView(row: {
    id: number;
    name: string;
    filename: string;
    size: number;
    durationMs: number;
    createdAt: Date;
  }): PhoneAudioView {
    return {
      id: row.id,
      name: row.name,
      filename: row.filename,
      size: row.size,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
    };
  }
}
