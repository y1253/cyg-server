import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

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

  async findAll(userId: number, userRole: string) {
    const isAdmin = userRole === 'ADMIN';
    const now = new Date();
    const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

    const companies = await this.prisma.company.findMany({
      where: {
        deletedAt: null,
        ...(!isAdmin && { assignments: { some: { userId } } }),
      },
      include: {
        assignments: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        todos: {
          where: { resolved: false },
          select: { id: true, dueDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return companies.map(company => {
      const assignedUser = company.assignments[0]?.user ?? null;
      const totalTodos = company.todos.length;
      const urgentTodos = company.todos.filter(
        t => t.dueDate !== null && t.dueDate < fiveDaysFromNow,
      ).length;
      const overdueTodos = company.todos.filter(
        t => t.dueDate !== null && t.dueDate < now,
      ).length;

      return {
        id: company.id,
        businessName: company.businessName,
        supportNumber: company.supportNumber,
        country: company.country,
        status: company.status,
        createdAt: company.createdAt,
        assignedUser,
        totalTodos,
        urgentTodos,
        overdueTodos,
      };
    });
  }

  async findOne(id: number, userId: number, userRole: string) {
    const isAdmin = userRole === 'ADMIN';

    const company = await this.prisma.company.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(!isAdmin && { assignments: { some: { userId } } }),
      },
      include: {
        contactInfo: true,
        legalInfo: true,
        accountant: true,
        assignments: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        todos: {
          include: { task: { select: { id: true, title: true, description: true } } },
          orderBy: [{ resolved: 'asc' }, { dueDate: 'asc' }],
        },
      },
    });

    if (!company) throw new NotFoundException('Company not found');

    const assignedUser = company.assignments[0]?.user ?? null;

    return {
      id: company.id,
      businessName: company.businessName,
      supportNumber: company.supportNumber,
      country: company.country,
      qbPlan: company.qbPlan,
      businessType: company.businessType,
      companyType: company.companyType,
      companyActivity: company.companyActivity,
      status: company.status,
      createdAt: company.createdAt,
      contactInfo: company.contactInfo,
      legalInfo: company.legalInfo,
      accountant: company.accountant,
      assignedUser,
      todos: company.todos,
    };
  }

  async update(id: number, dto: UpdateCompanyDto) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');

    try {
      return await this.prisma.company.update({
        where: { id },
        data: { supportNumber: dto.supportNumber },
        select: { id: true, supportNumber: true },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('This support number is already assigned to another company');
      }
      throw err;
    }
  }

  async assignUser(companyId: number, userId: number | null) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');

    await this.prisma.assignment.deleteMany({ where: { companyId } });

    if (userId !== null) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
      });
      if (!user) throw new NotFoundException('User not found');
      await this.prisma.assignment.create({ data: { companyId, userId } });
    }

    return { ok: true };
  }
}
