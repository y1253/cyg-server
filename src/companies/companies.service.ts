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

function decrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
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

    // Look up the Reconciliation task early so we can exclude it from the general
    // task loop — its schedules are created per-account below with proper notes.
    const reconciliationTask = await this.prisma.task.findFirst({
      where: { title: 'Reconciliation', deletedAt: null },
    });

    // Create a TaskSchedule + first todo for every active general task,
    // matching what createSchedulesForAllCompanies does for existing companies.
    // Reconciliation is excluded here and handled per-account below.
    const generalTasks = await this.prisma.task.findMany({
      where: {
        isGeneral: true,
        deletedAt: null,
        ...(reconciliationTask ? { id: { not: reconciliationTask.id } } : {}),
      },
    });

    for (const task of generalTasks) {
      const cycle = task.defaultCycle;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + cycle);
      await this.prisma.taskSchedule.create({
        data: {
          taskId: task.id,
          companyId: company.id,
          cycle,
          isImportant: task.isImportant,
          todos: {
            create: { taskId: task.id, companyId: company.id, dueDate },
          },
        },
      });
    }

    // Create reconciliation schedules for each declared account
    if (dto.reconciliationAccounts && dto.reconciliationAccounts.length > 0) {
      if (reconciliationTask) {
        for (let i = 0; i < dto.reconciliationAccounts.length; i++) {
          const account = dto.reconciliationAccounts[i];
          const startDate = new Date(account.startDate);
          const firstDue = new Date(startDate);
          firstDue.setDate(firstDue.getDate() + 30);
          const note = `${account.name} - ${account.type}`;
          // First account is the required base schedule (not custom, cannot be deleted).
          // Additional accounts are custom (teal badge, deletable by admins).
          const isManuallyAdded = i === 0 ? 0 : 1;

          const schedule = await this.prisma.taskSchedule.create({
            data: {
              taskId: reconciliationTask.id,
              companyId: company.id,
              cycle: 30,
              note,
              isImportant: reconciliationTask.isImportant,
              todos: {
                create: { taskId: reconciliationTask.id, companyId: company.id, dueDate: firstDue },
              },
            },
          });

          await this.prisma.$executeRaw`
            UPDATE TaskSchedule
            SET cycleType = 'DAYS', isManuallyAdded = ${isManuallyAdded}, startDate = ${startDate}
            WHERE id = ${schedule.id}
          `;
        }
      }
    }

    return { id: company.id, businessName: company.businessName };
  }

  async findAll(userId: number, userRole: string) {
    const isAdmin = userRole === 'ADMIN';
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

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
          where: {
            resolved: false,
            OR: [{ dueDate: null }, { dueDate: { lte: startOfToday } }],
          },
          select: { id: true, dueDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return companies.map(company => {
      const assignedUser = company.assignments[0]?.user ?? null;
      const totalTodos = company.todos.length;
      const urgentTodos = company.todos.filter(t => t.dueDate !== null).length;
      const overdueTodos = company.todos.filter(
        t => t.dueDate !== null && t.dueDate < startOfToday,
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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const encKey = process.env.ENCRYPTION_KEY;

    const company = await this.prisma.company.findFirst({
      where: {
        id,
        // Admins can view archived companies; non-admins only see active assigned ones
        ...(isAdmin ? {} : { deletedAt: null, assignments: { some: { userId } } }),
      },
      include: {
        contactInfo: true,
        legalInfo: true,
        accountant: true,
        billing: true,
        assignments: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        todos: {
          where: {
            OR: [{ dueDate: null }, { dueDate: { lte: startOfToday } }],
          },
          include: { task: { select: { id: true, title: true, description: true, isSnoozable: true } } },
          orderBy: [{ resolved: 'asc' }, { dueDate: 'asc' }],
        },
      },
    });

    if (!company) throw new NotFoundException('Company not found');

    const assignedUser = company.assignments[0]?.user ?? null;

    const billing = isAdmin && company.billing
      ? {
          billingEmail: company.billing.billingEmail,
          billingPassword:
            company.billing.billingPassword && encKey
              ? decrypt(company.billing.billingPassword, encKey)
              : null,
        }
      : null;

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
      deletedAt: company.deletedAt,
      contactInfo: company.contactInfo,
      legalInfo: company.legalInfo,
      accountant: company.accountant,
      billing,
      assignedUser,
      todos: company.todos,
    };
  }

  async update(id: number, dto: UpdateCompanyDto) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');

    const encKey = process.env.ENCRYPTION_KEY;

    try {
      // ── Company root ──────────────────────────────────────────────────────
      await this.prisma.company.update({
        where: { id },
        data: {
          ...(dto.businessName     !== undefined && { businessName:     dto.businessName }),
          ...(dto.businessType     !== undefined && { businessType:     dto.businessType as any }),
          ...(dto.companyType      !== undefined && { companyType:      dto.companyType as any }),
          ...(dto.companyActivity  !== undefined && { companyActivity:  dto.companyActivity }),
          ...(dto.country          !== undefined && { country:          dto.country }),
          ...(dto.qbPlan           !== undefined && { qbPlan:           dto.qbPlan }),
          ...(dto.supportNumber    !== undefined && { supportNumber:    dto.supportNumber || null }),
        },
      });

      // ── Contact info ──────────────────────────────────────────────────────
      const hasContact = [dto.personalName, dto.privateEmail, dto.privatePhone, dto.storeNumber]
        .some(v => v !== undefined);
      if (hasContact) {
        await this.prisma.contactInfo.upsert({
          where: { companyId: id },
          create: { companyId: id, personalName: dto.personalName, privateEmail: dto.privateEmail,
                    privatePhone: dto.privatePhone, storeNumber: dto.storeNumber },
          update: {
            ...(dto.personalName  !== undefined && { personalName:  dto.personalName }),
            ...(dto.privateEmail  !== undefined && { privateEmail:  dto.privateEmail }),
            ...(dto.privatePhone  !== undefined && { privatePhone:  dto.privatePhone }),
            ...(dto.storeNumber   !== undefined && { storeNumber:   dto.storeNumber }),
          },
        });
      }

      // ── Legal info ────────────────────────────────────────────────────────
      const hasLegal = [dto.neq, dto.revenueQcId, dto.craBn, dto.fiscalYear]
        .some(v => v !== undefined);
      if (hasLegal) {
        await this.prisma.legalInfo.upsert({
          where: { companyId: id },
          create: { companyId: id, neq: dto.neq, revenueQcId: dto.revenueQcId, craBn: dto.craBn,
                    fiscalYear: dto.fiscalYear },
          update: {
            ...(dto.neq          !== undefined && { neq:        dto.neq }),
            ...(dto.revenueQcId  !== undefined && { revenueQcId: dto.revenueQcId }),
            ...(dto.craBn        !== undefined && { craBn:      dto.craBn }),
            ...(dto.fiscalYear   !== undefined && { fiscalYear: dto.fiscalYear || null }),
          },
        });
      }

      // ── Accountant ────────────────────────────────────────────────────────
      const hasAccountant = [dto.accountantName, dto.accountantEmail, dto.accountantPhone]
        .some(v => v !== undefined);
      if (hasAccountant) {
        await this.prisma.accountant.upsert({
          where: { companyId: id },
          create: { companyId: id, name: dto.accountantName, email: dto.accountantEmail,
                    phone: dto.accountantPhone },
          update: {
            ...(dto.accountantName  !== undefined && { name:  dto.accountantName }),
            ...(dto.accountantEmail !== undefined && { email: dto.accountantEmail }),
            ...(dto.accountantPhone !== undefined && { phone: dto.accountantPhone }),
          },
        });
      }

      // ── Billing ───────────────────────────────────────────────────────────
      const hasBilling = [dto.billingEmail, dto.billingPassword].some(v => v !== undefined);
      if (hasBilling) {
        const encryptedPw = dto.billingPassword && encKey
          ? encrypt(dto.billingPassword, encKey)
          : undefined;
        await this.prisma.billing.upsert({
          where: { companyId: id },
          create: { companyId: id, billingEmail: dto.billingEmail,
                    billingPassword: encryptedPw },
          update: {
            ...(dto.billingEmail !== undefined && { billingEmail: dto.billingEmail }),
            ...(encryptedPw     !== undefined && { billingPassword: encryptedPw }),
          },
        });
      }

      return { id };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('This support number is already assigned to another company');
      }
      throw err;
    }
  }

  async remove(id: number) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) throw new NotFoundException('Company not found');
    await this.prisma.company.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  async findAllDeleted() {
    return this.prisma.company.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, businessName: true, country: true, businessType: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async restore(id: number) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!company) throw new NotFoundException('Deleted company not found');
    await this.prisma.company.update({ where: { id }, data: { deletedAt: null } });
    return { id };
  }

  async permanentDelete(id: number) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!company) throw new NotFoundException('Deleted company not found');
    await this.prisma.$transaction([
      this.prisma.link.deleteMany({ where: { companyId: id } }),
      this.prisma.todo.deleteMany({ where: { companyId: id } }),
      this.prisma.taskSchedule.deleteMany({ where: { companyId: id } }),
      this.prisma.assignment.deleteMany({ where: { companyId: id } }),
      this.prisma.legalInfo.deleteMany({ where: { companyId: id } }),
      this.prisma.contactInfo.deleteMany({ where: { companyId: id } }),
      this.prisma.billing.deleteMany({ where: { companyId: id } }),
      this.prisma.accountant.deleteMany({ where: { companyId: id } }),
      this.prisma.company.delete({ where: { id } }),
    ]);
    return { id };
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
