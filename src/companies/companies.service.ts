import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';

const ALGORITHM = 'aes-256-cbc';

function encrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async register(dto: RegisterCompanyDto) {
    const encKey = process.env.ENCRYPTION_KEY;
    if (!encKey) throw new Error('ENCRYPTION_KEY not set');

    // Resolve QB task title
    const qbTaskTitle = dto.hasQbAccount
      ? 'Follow up: Verify QuickBooks invite sent'
      : `Open QuickBooks Online ${dto.qbPlan}`;

    const qbTask = await this.prisma.task.findUnique({ where: { title: qbTaskTitle } });
    if (!qbTask) {
      throw new BadRequestException(`QB task not found: "${qbTaskTitle}". Run the seed first.`);
    }

    // Build nested contact info
    const hasContact =
      dto.personalName || dto.privateEmail || dto.privatePhone || dto.storeNumber;

    // Build nested legal info (Canada only)
    const hasLegal =
      dto.country === 'CANADA' && (dto.neq || dto.revenueQcId || dto.craBn || dto.fiscalYear);

    // Build nested billing
    const hasBilling = !!dto.billingEmail;

    // Build nested accountant
    const hasAccountant = !!dto.accountantName;

    // Encrypt billing password if provided
    const encryptedBillingPassword =
      hasBilling && dto.billingPassword ? encrypt(dto.billingPassword, encKey) : undefined;

    const company = await this.prisma.company.create({
      data: {
        businessName: dto.businessName,
        businessType: dto.businessType as any,
        companyType: dto.companyType as any,
        companyActivity: dto.companyActivity,
        country: dto.country,
        qbPlan: dto.hasQbAccount ? 'HAS_ACCOUNT' : dto.qbPlan,
        ...(hasContact && {
          contactInfo: {
            create: {
              personalName: dto.personalName,
              privateEmail: dto.privateEmail,
              privatePhone: dto.privatePhone,
              storeNumber: dto.storeNumber,
            },
          },
        }),
        ...(hasLegal && {
          legalInfo: {
            create: {
              neq: dto.neq,
              revenueQcId: dto.revenueQcId,
              craBn: dto.craBn,
              fiscalYear: dto.fiscalYear,
            },
          },
        }),
        ...(hasBilling && {
          billing: {
            create: {
              billingEmail: dto.billingEmail,
              billingPassword: encryptedBillingPassword,
            },
          },
        }),
        ...(hasAccountant && {
          accountant: {
            create: {
              name: dto.accountantName,
              email: dto.accountantEmail,
              phone: dto.accountantPhone,
            },
          },
        }),
      },
    });

    // Create the QB todo
    const dueDate = dto.hasQbAccount
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      : null;

    await this.prisma.todo.create({
      data: {
        taskId: qbTask.id,
        companyId: company.id,
        dueDate,
      },
    });

    return { id: company.id, businessName: company.businessName };
  }
}
