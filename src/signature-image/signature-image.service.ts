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
import { assertRealCompany } from '../companies/company-target.util.js';
import { signatureImageUrl } from '../communications/public-base.js';
import { imageIdOrNone } from '../email-signature/email-signature.util.js';
import {
  ensureSignatureImageDir,
  newImageStoragePath,
} from './signature-image.storage.js';
import {
  boundedSize,
  defaultImageName,
  imageScopeWhere,
  isImageInLibrary,
  isImageVisibleTo,
  MAX_COMPANY_LOGOS,
  type ImageScope,
} from './signature-image.util.js';

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
  /**
   * `null` = firm-wide, a number = private to that company.
   *
   * The client needs it to badge a tile and to show the delete affordance on a company's
   * OWN logos only — the firm-wide ones it may use but not edit. The admin library sees
   * `null` on every row it lists, so nothing changes there.
   */
  companyId: number | null;
}

@Injectable()
export class SignatureImageService {
  private readonly logger = new Logger(SignatureImageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The logos this scope may offer.
   *
   * `scope` defaults to `null` — the firm-wide library — so the ADMIN routes keep their
   * exact previous call. A company gets the firm-wide logos PLUS its own; see
   * `imageScopeWhere`, whose spec pins that the firm-wide branch carries no `OR`.
   */
  async list(scope: ImageScope = null): Promise<SignatureImageView[]> {
    const rows = await this.prisma.signatureImage.findMany({
      where: { deletedAt: null, ...imageScopeWhere(scope) },
      // This company's own logos first. A no-op for the firm-wide list, where every row's
      // companyId is NULL — which is why one orderBy serves both and the old ordering is
      // unchanged.
      orderBy: [{ companyId: 'desc' }, { createdAt: 'desc' }],
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
    scope: ImageScope = null,
  ): Promise<SignatureImageView> {
    if (scope !== null) await this.assertScopeCompany(scope);

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

    // Counted AFTER the decode, so a rejected file never counts against the ceiling, and
    // as late as possible so the window in which a parallel upload could slip past is as
    // small as it can be without a transaction. The cap is a budget on the one new
    // write-to-disk surface a MANAGER gains, not a correctness boundary.
    if (scope !== null) {
      const existing = await this.prisma.signatureImage.count({
        where: { companyId: scope, deletedAt: null },
      });
      if (existing >= MAX_COMPANY_LOGOS) {
        throw new BadRequestException(
          `This company already has ${MAX_COMPANY_LOGOS} logos. Remove one first.`,
        );
      }
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
        companyId: scope,
      },
    });
    return this.toView(row);
  }

  async rename(
    id: number,
    name: string,
    scope: ImageScope = null,
  ): Promise<SignatureImageView> {
    await this.getInLibraryOrThrow(id, scope);
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
  async remove(id: number, scope: ImageScope = null): Promise<void> {
    await this.getInLibraryOrThrow(id, scope);
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
   *
   * ⚠️ `scope` is OPTIONAL and the hot path deliberately omits it. Scope is enforced on the
   * WRITE path by `assertUsableBy`, which is what guarantees a stored id is in scope;
   * re-checking here would (a) contradict this method's never-throws contract by turning a
   * hand-edited row into a *silently* missing logo rather than a visible, fixable one, and
   * (b) protect nothing — the URL it returns is public and unauthenticated by design, and a
   * company logo is not a secret. The parameter exists solely so `preview` can show what a
   * save would actually accept.
   */
  async urlFor(
    settingValue: number | null | undefined,
    scope?: ImageScope,
  ): Promise<string | null> {
    const id = imageIdOrNone(settingValue);
    if (id === null) return null;
    try {
      const row = await this.prisma.signatureImage.findFirst({
        where: {
          id,
          deletedAt: null,
          // `undefined` means NO scope check, and that is the hot path's setting. See the
          // docblock above: scoping here would turn a hand-edited row into a silently
          // missing logo, and it protects nothing — this URL is public by design.
          ...(scope !== undefined ? imageScopeWhere(scope) : {}),
        },
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

  /**
   * Refuse a settings save that names a logo this scope cannot see.
   *
   * `0` ("no logo") and `null` ("inherit") short-circuit through `imageIdOrNone`, so the
   * sentinel stays interpreted in exactly one place.
   *
   * BadRequest rather than NotFound: unlike `getInLibraryOrThrow` below, nothing is being
   * disclosed — the caller already had to know the id, and the client surfaces this
   * message verbatim so an admin learns why the save was refused.
   */
  async assertUsableBy(
    settingValue: unknown,
    scope: ImageScope,
  ): Promise<void> {
    const id = imageIdOrNone(
      typeof settingValue === 'number' ? settingValue : null,
    );
    if (id === null) return;

    const row = await this.prisma.signatureImage.findFirst({
      where: { id, deletedAt: null },
      select: { companyId: true },
    });
    if (!row) throw new BadRequestException('That logo no longer exists');
    if (!isImageVisibleTo(row.companyId, scope)) {
      throw new BadRequestException(
        scope === null
          ? 'That logo belongs to one company and cannot be the firm-wide default'
          : 'That logo belongs to another company',
      );
    }
  }

  /** The company a scoped request names, or 404/400. See `assertRealCompany`. */
  private assertScopeCompany(companyId: number) {
    return assertRealCompany(
      this.prisma,
      companyId,
      'Internal workspaces send no email and have no signature logos',
    );
  }

  /**
   * The row this scope may RENAME OR DELETE, or 404.
   *
   * 404 rather than 403 on a cross-scope id, deliberately: "that logo exists but belongs
   * to somebody else" is itself a disclosure. Same rule as `assertParticipant` in
   * internal-calls.
   *
   * Note this is `isImageInLibrary`, not `isImageVisibleTo` — a company may USE a
   * firm-wide logo and must never be able to rename or delete one.
   */
  private async getInLibraryOrThrow(id: number, scope: ImageScope) {
    const row = await this.getOrThrow(id);
    if (!isImageInLibrary(row.companyId, scope)) {
      throw new NotFoundException('Image not found');
    }
    return row;
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
    companyId: number | null;
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
      companyId: row.companyId,
    };
  }
}
