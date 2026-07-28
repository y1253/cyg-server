import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { ensureInternalWorkspace } from '../companies/internal-workspace.js';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
    private luxand: LuxandService,
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

  async faceLogin(email: string, photo: Buffer, mimeType: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.faceImages || user.faceImages.length === 0) {
      throw new UnauthorizedException('Face not enrolled for this account');
    }

    const match = await this.luxand.searchFace(photo, mimeType);
    if (!match || !user.faceImages.some((fi) => fi.luxandId === match.uuid)) {
      throw new UnauthorizedException('Face not recognized');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
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
