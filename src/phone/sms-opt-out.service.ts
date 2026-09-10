import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The do-not-text list.
 *
 * Campaign-wide rather than per-company — see the `SmsOptOut` model comment. Every write
 * here is driven by an inbound message the customer actually sent, never by staff, so
 * there is no admin route to add or remove an entry: the only way off the list is the
 * customer texting START, which is exactly the consent record a carrier would ask for.
 */
@Injectable()
export class SmsOptOutService {
  private readonly logger = new Logger(SmsOptOutService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Record an opt-out. Idempotent — texting STOP twice is not an error. */
  async optOut(phoneNumber: string, keyword: string): Promise<void> {
    await this.prisma.smsOptOut.upsert({
      where: { phoneNumber },
      // A repeat STOP does NOT move `optedOutAt`. The first one is the date that
      // matters if we ever have to evidence when messaging should have ceased.
      update: {},
      create: { phoneNumber, keyword },
    });
    this.logger.log(`opt-out ${phoneNumber} keyword=${keyword}`);
  }

  /** Clear an opt-out. Deleting a row that is not there is a no-op, not an error. */
  async optIn(phoneNumber: string): Promise<void> {
    const { count } = await this.prisma.smsOptOut.deleteMany({
      where: { phoneNumber },
    });
    if (count > 0) this.logger.log(`opt-in ${phoneNumber}`);
  }

  async isOptedOut(phoneNumber: string): Promise<boolean> {
    const row = await this.prisma.smsOptOut.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });
    return row !== null;
  }
}
