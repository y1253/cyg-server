import { writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveStoredPath } from '../internal-messages/uploads.js';
import { signatureImageUrl } from '../communications/public-base.js';
import { imageIdOrNone } from '../email-signature/email-signature.util.js';
import {
  ensureSignatureImageDir,
  newImageStoragePath,
} from './signature-image.storage.js';
import { boundedSize, defaultImageName } from './signature-image.util.js';

/** What the admin library shows. `storagePath` deliberately never leaves the server. */
export interface SignatureImageView {
  id: number;
  name: string;
  filename: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
  /** Absolute, unauthenticated URL — the same one that goes into an email. */
  url: string;
}

@Injectable()
export class SignatureImageService {
  private readonly logger = new Logger(SignatureImageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<SignatureImageView[]> {
    const rows = await this.prisma.signatureImage.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * Store one logo.
   *
   * Order: re-encode, write the file, then record the row — the `PhoneAudioService.create`
   * ordering, for the same reason. The row is created LAST, once the bytes are safely on
   * disk, so a row can never name a file that does not exist. The reverse leaves a settings
   * row pointing at nothing, which renders as a broken image in every outgoing email.
   */
  async create(
    file: { buffer: Buffer; originalname: string },
    name: string | undefined,
    uploadedById: number,
  ): Promise<SignatureImageView> {
    let png: Buffer;
    let width: number;
    let height: number;
    try {
      const source = sharp(file.buffer, { failOn: 'none' });
      const meta = await source.metadata();
      const bounded = boundedSize({
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      });
      png = await source
        .resize(bounded.width, bounded.height, { fit: 'inside' })
        // One output format, so `mimeType` is a constant and mail-client compatibility
        // stops being a runtime concern. PNG rather than JPEG because a logo usually has
        // flat colour and a transparent background, both of which JPEG ruins.
        .png({ compressionLevel: 9 })
        .toBuffer();
      const out = await sharp(png).metadata();
      width = out.width ?? bounded.width;
      height = out.height ?? bounded.height;
    } catch (err) {
      // sharp's own error text is for developers, so it goes to the log and the admin gets
      // a sentence they can act on. Same split as the ffmpeg failure in phone-audio.
      this.logger.warn(`signature image decode failed: ${String(err)}`);
      throw new BadRequestException(
        'That file could not be read as an image. Try a PNG or JPEG.',
      );
    }

    const storagePath = newImageStoragePath();
    ensureSignatureImageDir();
    await writeFile(resolveStoredPath(storagePath), png);

    const row = await this.prisma.signatureImage.create({
      data: {
        name: (name ?? '').trim() || defaultImageName(file.originalname),
        publicId: randomUUID(),
        filename: file.originalname,
        mimeType: 'image/png',
        size: png.length,
        width,
        height,
        storagePath,
        uploadedById,
      },
    });
    return this.toView(row);
  }

  async rename(id: number, name: string): Promise<SignatureImageView> {
    await this.getOrThrow(id);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('A name is required');
    const row = await this.prisma.signatureImage.update({
      where: { id },
      data: { name: trimmed.slice(0, 80) },
    });
    return this.toView(row);
  }

  /**
   * Soft delete. The row stays because settings rows name this id with no FK to protect
   * them — a hard delete would leave a company pointing at nothing, with nothing able to
   * report it. Mirrors `PhoneAudioService.remove`.
   */
  async remove(id: number): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.signatureImage.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The public URL for a settings value, or `null`.
   *
   * **Never throws.** This runs while a signature is being built for the Communications
   * tab, and a signature without its logo is a far better outcome than a 500 on the whole
   * tab. A settings row that outlived its image logs a warning — that is a real
   * misconfiguration somebody should see — and renders as no logo.
   */
  async urlFor(settingValue: number | null | undefined): Promise<string | null> {
    const id = imageIdOrNone(settingValue);
    if (id === null) return null;
    try {
      const row = await this.prisma.signatureImage.findFirst({
        where: { id, deletedAt: null },
        select: { publicId: true },
      });
      if (!row) {
        this.logger.warn(
          `email signature names image ${id}, which is missing or deleted — rendering without a logo`,
        );
        return null;
      }
      return signatureImageUrl(process.env, row.publicId);
    } catch (err) {
      this.logger.warn(`signature image lookup failed: ${String(err)}`);
      return null;
    }
  }

  /** What the public route needs to stream one logo, looked up by its public id. */
  async streamableByPublicId(publicId: string): Promise<{
    absolutePath: string;
    mimeType: string;
    filename: string;
  }> {
    const row = await this.prisma.signatureImage.findFirst({
      where: { publicId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Image not found');
    return {
      absolutePath: resolveStoredPath(row.storagePath),
      mimeType: row.mimeType,
      filename: `${row.name}.png`,
    };
  }

  private async getOrThrow(id: number) {
    const row = await this.prisma.signatureImage.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Image not found');
    return row;
  }

  private toView(row: {
    id: number;
    name: string;
    publicId: string;
    filename: string;
    size: number;
    width: number;
    height: number;
    createdAt: Date;
  }): SignatureImageView {
    return {
      id: row.id,
      name: row.name,
      filename: row.filename,
      size: row.size,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt.toISOString(),
      url: signatureImageUrl(process.env, row.publicId),
    };
  }
}
