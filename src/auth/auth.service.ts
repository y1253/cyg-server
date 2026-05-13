import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LuxandService } from '../luxand/luxand.service.js';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private config: ConfigService,
    private luxand: LuxandService,
  ) {}

  async adminLogin(email: string, password: string) {
    const adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL');
    const adminPassword = this.config.getOrThrow<string>('ADMIN_PASSWORD');
    const adminName = this.config.get<string>('ADMIN_NAME') ?? 'Admin';

    if (email !== adminEmail || password !== adminPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: 0, email: adminEmail, name: adminName, role: 'ADMIN' };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: 0, name: adminName, email: adminEmail, role: 'ADMIN' },
    };
  }

  async faceLogin(email: string, photo: Buffer, mimeType: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.luxandId) {
      throw new UnauthorizedException('Face not enrolled for this account');
    }

    const match = await this.luxand.searchFace(photo, mimeType);
    if (!match || match.uuid !== user.luxandId) {
      throw new UnauthorizedException('Face not recognized');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }
}
