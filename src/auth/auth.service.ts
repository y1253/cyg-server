import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { FaceEnhancerService } from '../luxand/face-enhancer.service.js';
import { parseFaceBox, type RawPhoto } from '../luxand/face-image.js';
import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { ensureInternalWorkspace } from '../companies/internal-workspace.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
    private luxand: LuxandService,
    private enhancer: FaceEnhancerService,
    private prisma: PrismaService,
  ) {}

  async adminLogin(email: string, password: string) {
    const adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL');
    const adminPassword = this.config.getOrThrow<string>('ADMIN_PASSWORD');
    const adminName = this.config.get<string>('ADMIN_NAME') ?? 'Admin';

    if (email !== adminEmail || password !== adminPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // The env-admin must be backed by a real User row: internal messages carry a
    // `senderId` FK, and the client compares `user.id` to decide what is "mine".
    // This used to sign `sub: 0`, which is not a real row and broke both. Upsert
    // rather than throw so existing deployments self-heal on the next login.
    const admin = await this.prisma.user.upsert({
      where: { email: adminEmail },
      update: { deletedAt: null, role: Role.ADMIN },
      create: { name: adminName, email: adminEmail, role: Role.ADMIN },
    });
    await ensureInternalWorkspace(this.prisma, admin.id);

    const payload = {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    };
  }

  /**
   * Face login, asked as a 1:1 question.
   *
   * The user types their email before the camera ever opens, so we already know
   * which identity they are claiming. Comparing against that one person instead of
   * scanning the whole gallery is the change that makes this fast and keeps it fast
   * as staff are added.
   *
   * Both env switches below are kill-switches: if verify or liveness misbehaves in
   * production, flip the variable and `pm2 restart` rather than shipping a hotfix
   * while nobody can sign in.
   */
  async faceLogin(
    email: string,
    photo: Buffer,
    mimeType: string,
    faceBox?: string,
  ) {
    const started = Date.now();

    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const subjectId = user.faceSubject?.subjectId;
    if (!subjectId) {
      throw new UnauthorizedException('Face not enrolled for this account');
    }

    const raw: RawPhoto = { buffer: photo, mimeType };
    const mode = this.config.get<string>('LUXAND_LOGIN_MODE') ?? 'verify';
    const livenessEnabled = this.config.get<string>('LUXAND_LIVENESS') !== '0';

    // Liveness reads the raw frame and must never see the enhanced one (see
    // LuxandService.liveness), so it needs no preparation at all. Starting it
    // here means the enhancement pass runs while that request is already in
    // flight: the login costs max(enhance + verify, liveness) rather than
    // enhance + max(verify, liveness).
    const livePromise = livenessEnabled
      ? this.luxand.liveness(raw)
      : Promise.resolve({ live: true, score: null });
    // A promise that exists but is not yet awaited becomes an unhandled
    // rejection if the line below throws first, and Node exits the process on
    // those. This is a crash guard, not tidiness.
    livePromise.catch(() => undefined);

    // The client detected the face already; the box is only ever an optimisation.
    // Anything unparseable degrades to the no-box path rather than failing the
    // login, so a stale client build cannot lock anyone out.
    const box = parseFaceBox(faceBox);
    const enhanceStarted = Date.now();
    const enhanced = await this.enhancer.enhance(raw, box, 'login');
    const enhanceMs = Date.now() - enhanceStarted;

    const [identity, live] = await Promise.all([
      mode === 'search'
        ? this.luxand.search(enhanced).then((m) => ({
            matched: m?.uuid === subjectId,
            probability: m?.probability ?? null,
          }))
        : this.luxand.verify(subjectId, enhanced),
      livePromise,
    ]);

    // Log the score on rejection too: when a genuine user is turned away, it is the
    // only evidence separating a badly tuned threshold from a bad photo.
    this.logger.log(
      `faceLogin ${email} ${identity.matched ? 'MATCH' : 'REJECT'} mode=${mode} ` +
        `prob=${identity.probability ?? '-'} live=${live.score ?? '-'} ` +
        `box=${box ? 'y' : 'n'} enh=${enhanceMs}ms total=${Date.now() - started}ms`,
    );

    // One message for both failures — which check failed is free information.
    if (!live.live || !identity.matched) {
      throw new UnauthorizedException('Face not recognized');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
