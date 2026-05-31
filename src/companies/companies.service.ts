import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { computeFirstDue } from '../task-schedules/compute-next-due.js';

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

    // Create a company note if location visit was requested
    if (dto.locationVisitEnabled === true) {
      const freq = dto.locationVisitFrequency === 'monthly' ? 'Monthly' : 'Quarterly';
      await this.prisma.companyNote.create({
        data: { companyId: company.id, content: `Location visit requested: ${freq}` },
      });
    }

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

    // Handle accounts payable schedule preference
    if (dto.apManageBills !== undefined) {
      const apTask = await this.prisma.task.findFirst({
        where: { title: 'Accounts payable report', isGeneral: true, deletedAt: null },
      });
      if (apTask) {
        const apSchedule = await this.prisma.taskSchedule.findFirst({
          where: { taskId: apTask.id, companyId: company.id, deletedAt: null },
        });
        if (apSchedule) {
          if (dto.apManageBills === false) {
            await this.prisma.taskSchedule.update({
              where: { id: apSchedule.id },
              data: { deletedAt: new Date() },
            });
            await this.prisma.todo.deleteMany({
              where: { scheduleId: apSchedule.id, resolved: false },
            });
          } else {
            const cycleType = dto.apCycleType ?? 'DAYS';
            const startDate = dto.apStartDate ? new Date(dto.apStartDate) : new Date();
            const cycleVal = dto.apCycle ?? 30;

            await this.prisma.taskSchedule.update({
              where: { id: apSchedule.id },
              data: { cycle: cycleVal },
            });

            await this.prisma.$executeRaw`
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${dto.apCycleDay ?? null},
                  cycleNth  = ${dto.apCycleNth ?? null},
                  startDate = ${startDate}
              WHERE id = ${apSchedule.id}
            `;

            await this.prisma.todo.deleteMany({
              where: { scheduleId: apSchedule.id, resolved: false },
            });

            const firstDue = computeFirstDue(startDate, {
              cycle: cycleVal,
              cycleType,
              cycleDay: dto.apCycleDay ?? null,
              cycleNth: dto.apCycleNth ?? null,
            });

            await this.prisma.todo.create({
              data: {
                taskId: apTask.id,
                companyId: company.id,
                scheduleId: apSchedule.id,
                dueDate: firstDue,
              },
            });
          }
        }
      }
    }

    // Handle accounts receivable schedule preferences
    const arRules: Array<{
      title: string;
      enabled: boolean | undefined;
      cycleType: string | undefined;
      cycle: number | undefined;
      cycleDay: number | undefined;
      cycleNth: number | undefined;
      note: string | undefined;
    }> = [
      {
        title: 'invoicing',
        enabled: dto.arInvoicingEnabled,
        cycleType: dto.arInvoicingCycleType,
        cycle: dto.arInvoicingCycle,
        cycleDay: dto.arInvoicingCycleDay,
        cycleNth: dto.arInvoicingCycleNth,
        note: dto.arInvoicingNote,
      },
      {
        title: 'account receivable statement',
        enabled: dto.arStatementsEnabled,
        cycleType: dto.arStatementsCycleType,
        cycle: dto.arStatementsCycle,
        cycleDay: dto.arStatementsCycleDay,
        cycleNth: dto.arStatementsCycleNth,
        note: dto.arStatementsNote,
      },
      {
        title: 'account receivable management',
        enabled: dto.arCollectionEnabled,
        cycleType: dto.arCollectionCycleType,
        cycle: dto.arCollectionCycle,
        cycleDay: dto.arCollectionCycleDay,
        cycleNth: dto.arCollectionCycleNth,
        note: dto.arCollectionNote,
      },
      {
        title: 'account receivable report',
        enabled: dto.arReportEnabled,
        cycleType: dto.arReportCycleType,
        cycle: dto.arReportCycle,
        cycleDay: dto.arReportCycleDay,
        cycleNth: dto.arReportCycleNth,
        note: dto.arReportNote,
      },
    ];

    for (const rule of arRules) {
      if (rule.enabled === undefined) continue;

      const arTask = await this.prisma.task.findFirst({
        where: { title: rule.title, isGeneral: true, deletedAt: null },
      });
      if (!arTask) continue;

      const arSchedule = await this.prisma.taskSchedule.findFirst({
        where: { taskId: arTask.id, companyId: company.id, deletedAt: null },
      });
      if (!arSchedule) continue;

      if (rule.enabled === false) {
        await this.prisma.taskSchedule.update({
          where: { id: arSchedule.id },
          data: { deletedAt: new Date() },
        });
        await this.prisma.todo.deleteMany({
          where: { scheduleId: arSchedule.id, resolved: false },
        });
      } else {
        const cycleType = rule.cycleType ?? 'DAYS';
        const cycleVal = rule.cycle ?? 30;

        await this.prisma.taskSchedule.update({
          where: { id: arSchedule.id },
          data: { cycle: cycleVal, note: rule.note || null },
        });

        await this.prisma.$executeRaw`
          UPDATE TaskSchedule
          SET cycleType = ${cycleType},
              cycleDay  = ${rule.cycleDay ?? null},
              cycleNth  = ${rule.cycleNth ?? null}
          WHERE id = ${arSchedule.id}
        `;
      }
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

    // Handle payroll management (all companies)
    if (dto.payrollEnabled !== undefined) {
      const payrollTask = await this.prisma.task.findFirst({
        where: { title: 'Prepare payroll checks', deletedAt: null },
      });
      if (payrollTask) {
        const payrollSchedule = await this.prisma.taskSchedule.findFirst({
          where: { taskId: payrollTask.id, companyId: company.id, deletedAt: null },
        });
        if (payrollSchedule) {
          if (dto.payrollEnabled === false) {
            await this.prisma.taskSchedule.update({
              where: { id: payrollSchedule.id },
              data: { deletedAt: new Date() },
            });
            await this.prisma.todo.deleteMany({
              where: { scheduleId: payrollSchedule.id, resolved: false },
            });
          } else {
            const cycleType = dto.payrollCycleType ?? 'DAYS';
            const cycleVal = dto.payrollCycle ?? 30;

            await this.prisma.taskSchedule.update({
              where: { id: payrollSchedule.id },
              data: { cycle: cycleVal, note: dto.payrollNote || null },
            });

            await this.prisma.$executeRaw`
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${dto.payrollCycleDay ?? null},
                  cycleNth  = ${dto.payrollCycleNth ?? null}
              WHERE id = ${payrollSchedule.id}
            `;

            await this.prisma.todo.deleteMany({
              where: { scheduleId: payrollSchedule.id, resolved: false },
            });

            const firstDue = computeFirstDue(new Date(), {
              cycle: cycleVal,
              cycleType,
              cycleDay: dto.payrollCycleDay ?? null,
              cycleNth: dto.payrollCycleNth ?? null,
            });

            await this.prisma.todo.create({
              data: {
                taskId: payrollTask.id,
                companyId: company.id,
                scheduleId: payrollSchedule.id,
                dueDate: firstDue,
              },
            });
          }
        }
      }
    }

    // Handle Canadian-specific payroll tasks
    if (dto.country === 'CANADA') {
      // Payroll tax filing
      if (dto.payrollTaxEnabled !== undefined) {
        const cadTask = await this.prisma.task.findFirst({
          where: { title: 'Payroll tax CAD', deletedAt: null },
        });
        const qcTask = await this.prisma.task.findFirst({
          where: { title: 'Payroll tax QC', deletedAt: null },
        });

        const cadSchedule = cadTask
          ? await this.prisma.taskSchedule.findFirst({
              where: { taskId: cadTask.id, companyId: company.id, deletedAt: null },
            })
          : null;
        const qcSchedule = qcTask
          ? await this.prisma.taskSchedule.findFirst({
              where: { taskId: qcTask.id, companyId: company.id, deletedAt: null },
            })
          : null;

        if (dto.payrollTaxEnabled === false) {
          for (const s of [cadSchedule, qcSchedule]) {
            if (!s) continue;
            await this.prisma.taskSchedule.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
            await this.prisma.todo.deleteMany({ where: { scheduleId: s.id, resolved: false } });
          }
        } else if (dto.payrollTaxEnabled === true && dto.payrollTaxRegion) {
          const isCAD = dto.payrollTaxRegion === 'CAD';
          const activeSchedule = isCAD ? cadSchedule : qcSchedule;
          const activeTask = isCAD ? cadTask : qcTask;
          const inactiveSchedule = isCAD ? qcSchedule : cadSchedule;

          if (inactiveSchedule) {
            await this.prisma.taskSchedule.update({ where: { id: inactiveSchedule.id }, data: { deletedAt: new Date() } });
            await this.prisma.todo.deleteMany({ where: { scheduleId: inactiveSchedule.id, resolved: false } });
          }

          if (activeSchedule && activeTask) {
            const cycleType = dto.payrollTaxCycleType ?? 'DAYS';
            const cycleVal = dto.payrollTaxCycle ?? 30;

            await this.prisma.taskSchedule.update({
              where: { id: activeSchedule.id },
              data: { cycle: cycleVal, note: dto.payrollTaxNote || null },
            });

            await this.prisma.$executeRaw`
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${dto.payrollTaxCycleDay ?? null},
                  cycleNth  = ${dto.payrollTaxCycleNth ?? null}
              WHERE id = ${activeSchedule.id}
            `;

            await this.prisma.todo.deleteMany({ where: { scheduleId: activeSchedule.id, resolved: false } });

            const firstDue = computeFirstDue(new Date(), {
              cycle: cycleVal,
              cycleType,
              cycleDay: dto.payrollTaxCycleDay ?? null,
              cycleNth: dto.payrollTaxCycleNth ?? null,
            });

            await this.prisma.todo.create({
              data: {
                taskId: activeTask.id,
                companyId: company.id,
                scheduleId: activeSchedule.id,
                dueDate: firstDue,
              },
            });
          }
        }
      }

      // Payroll year-end
      if (dto.payrollYearEndEnabled !== undefined) {
        const yearEndEntries = [
          { title: 'RL-1 and Summery', enabled: dto.payrollYearEndRl1 ?? false },
          { title: 'T4 / T4A and summery', enabled: dto.payrollYearEndT4 ?? false },
          { title: 'CNESST Update', enabled: dto.payrollYearEndCnesst ?? false },
          { title: 'CNESST statement of wages', enabled: dto.payrollYearEndCnesst ?? false },
          { title: 'CNESST Documents', enabled: dto.payrollYearEndCnesst ?? false },
        ];

        for (const entry of yearEndEntries) {
          const task = await this.prisma.task.findFirst({ where: { title: entry.title, deletedAt: null } });
          if (!task) continue;
          const schedule = await this.prisma.taskSchedule.findFirst({
            where: { taskId: task.id, companyId: company.id, deletedAt: null },
          });
          if (!schedule) continue;

          const shouldEnable = dto.payrollYearEndEnabled === true && entry.enabled;

          if (!shouldEnable) {
            await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { deletedAt: new Date() } });
            await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
          } else {
            await this.prisma.$executeRaw`
              UPDATE TaskSchedule
              SET cycleType = 'YEARLY',
                  cycleDay  = 15,
                  cycleNth  = 1
              WHERE id = ${schedule.id}
            `;

            await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });

            const firstDue = computeFirstDue(new Date(), {
              cycle: 30,
              cycleType: 'YEARLY',
              cycleDay: 15,
              cycleNth: 1,
            });

            await this.prisma.todo.create({
              data: {
                taskId: task.id,
                companyId: company.id,
                scheduleId: schedule.id,
                dueDate: firstDue,
              },
            });
          }
        }
      }
      // Canadian doc/tax schedule rules (General step)
      const canadianDocRules: Array<{ title: string; enabled: boolean | undefined; note: string | undefined }> = [
        { title: 'Quebec Gov. documents and balances', enabled: dto.qcDocsEnabled, note: dto.qcDocsNote },
        { title: 'CRA Gov. documents and balances', enabled: dto.craDocsEnabled, note: dto.craDocsNote },
        { title: 'Sales tax filing', enabled: dto.salesTaxEnabled, note: dto.salesTaxNote },
      ];

      for (const rule of canadianDocRules) {
        if (rule.enabled === undefined) continue;
        const task = await this.prisma.task.findFirst({ where: { title: rule.title, isGeneral: true, deletedAt: null } });
        if (!task) continue;
        const schedule = await this.prisma.taskSchedule.findFirst({ where: { taskId: task.id, companyId: company.id, deletedAt: null } });
        if (!schedule) continue;
        if (rule.enabled === false) {
          await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { deletedAt: new Date() } });
          await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
        } else {
          await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { note: rule.note || null } });
        }
      }
    } else {
      // US company — disable all Canadian-specific schedules
      const canadianTitles = [
        'Payroll tax CAD',
        'Payroll tax QC',
        'RL-1 and Summery',
        'T4 / T4A and summery',
        'CNESST Update',
        'CNESST statement of wages',
        'CNESST Documents',
        'Quebec Gov. documents and balances',
        'CRA Gov. documents and balances',
        'Sales tax filing',
      ];

      for (const title of canadianTitles) {
        const task = await this.prisma.task.findFirst({ where: { title, deletedAt: null } });
        if (!task) continue;
        const schedule = await this.prisma.taskSchedule.findFirst({
          where: { taskId: task.id, companyId: company.id, deletedAt: null },
        });
        if (!schedule) continue;
        await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { deletedAt: new Date() } });
        await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
      }
    }

    // Handle cash flow management schedules (two schedules share the same cycle/note)
    if (dto.cashFlowEnabled !== undefined) {
      for (const title of ['Cash flow management', 'Daily cash flow']) {
        const cfTask = await this.prisma.task.findFirst({ where: { title, deletedAt: null } });
        if (!cfTask) continue;
        const cfSchedule = await this.prisma.taskSchedule.findFirst({
          where: { taskId: cfTask.id, companyId: company.id, deletedAt: null },
        });
        if (!cfSchedule) continue;

        if (dto.cashFlowEnabled === false) {
          await this.prisma.taskSchedule.update({ where: { id: cfSchedule.id }, data: { deletedAt: new Date() } });
          await this.prisma.todo.deleteMany({ where: { scheduleId: cfSchedule.id, resolved: false } });
        } else {
          const cycleType = dto.cashFlowCycleType ?? 'DAYS';
          const cycleVal = dto.cashFlowCycle ?? 30;

          await this.prisma.taskSchedule.update({
            where: { id: cfSchedule.id },
            data: { cycle: cycleVal, note: dto.cashFlowNote || null },
          });

          await this.prisma.$executeRaw`
            UPDATE TaskSchedule
            SET cycleType = ${cycleType},
                cycleDay  = ${dto.cashFlowCycleDay ?? null},
                cycleNth  = ${dto.cashFlowCycleNth ?? null}
            WHERE id = ${cfSchedule.id}
          `;
        }
      }
    }

    // Handle credit card management schedule
    if (dto.creditCardEnabled !== undefined) {
      const ccTask = await this.prisma.task.findFirst({
        where: { title: 'Credit Card Management', deletedAt: null },
      });
      if (ccTask) {
        const ccSchedule = await this.prisma.taskSchedule.findFirst({
          where: { taskId: ccTask.id, companyId: company.id, deletedAt: null },
        });
        if (ccSchedule) {
          if (dto.creditCardEnabled === false) {
            await this.prisma.taskSchedule.update({ where: { id: ccSchedule.id }, data: { deletedAt: new Date() } });
            await this.prisma.todo.deleteMany({ where: { scheduleId: ccSchedule.id, resolved: false } });
          } else {
            // If limit sub-question is Yes, use limit cycle and put amount in note
            const useLimitCycle = dto.creditCardLimitEnabled === true;
            const cycleType = (useLimitCycle ? dto.creditCardLimitCycleType : dto.creditCardCycleType) ?? 'DAYS';
            const cycleVal = (useLimitCycle ? dto.creditCardLimitCycle : dto.creditCardCycle) ?? 30;
            const cycleDay = useLimitCycle ? (dto.creditCardLimitCycleDay ?? null) : (dto.creditCardCycleDay ?? null);
            const cycleNth = useLimitCycle ? (dto.creditCardLimitCycleNth ?? null) : (dto.creditCardCycleNth ?? null);
            const note = useLimitCycle ? (dto.creditCardLimitAmount || null) : (dto.creditCardNote || null);

            await this.prisma.taskSchedule.update({
              where: { id: ccSchedule.id },
              data: { cycle: cycleVal, note },
            });

            await this.prisma.$executeRaw`
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${cycleDay},
                  cycleNth  = ${cycleNth}
              WHERE id = ${ccSchedule.id}
            `;
          }
        }
      }
    }

    // Handle receipt tracking schedule
    if (dto.receiptTrackingEnabled !== undefined) {
      const rtTask = await this.prisma.task.findFirst({
        where: { title: 'Receipt tracking', deletedAt: null },
      });
      if (rtTask) {
        const rtSchedule = await this.prisma.taskSchedule.findFirst({
          where: { taskId: rtTask.id, companyId: company.id, deletedAt: null },
        });
        if (rtSchedule) {
          if (dto.receiptTrackingEnabled === false) {
            await this.prisma.taskSchedule.update({ where: { id: rtSchedule.id }, data: { deletedAt: new Date() } });
            await this.prisma.todo.deleteMany({ where: { scheduleId: rtSchedule.id, resolved: false } });
          } else {
            const cycleType = dto.receiptTrackingCycleType ?? 'DAYS';
            const cycleVal = dto.receiptTrackingCycle ?? 30;

            await this.prisma.taskSchedule.update({
              where: { id: rtSchedule.id },
              data: { cycle: cycleVal, note: dto.receiptTrackingNote || null },
            });

            await this.prisma.$executeRaw`
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${dto.receiptTrackingCycleDay ?? null},
                  cycleNth  = ${dto.receiptTrackingCycleNth ?? null}
              WHERE id = ${rtSchedule.id}
            `;
          }
        }
      }
    }

    // Card on file: store card info as a company note
    if (dto.cardNumber) {
      await this.prisma.companyNote.create({
        data: {
          companyId: company.id,
          content: `Card on file — Name: ${dto.cardHolderName}, Card: ${dto.cardNumber}, Expiry: ${dto.cardExpiry}, CVV: ${dto.cardCvv}`,
        },
      });
    }

    // Fiscal year: set "closing the books" + "year end filling" to YEARLY, 1 month after FY end
    if (dto.fiscalYear) {
      const parts = dto.fiscalYear.split('-'); // "2000-MM-DD"
      const fyMonth = parseInt(parts[1], 10);  // 1–12
      const fyDay   = parseInt(parts[2], 10);  // 1–31
      const targetMonth = fyMonth === 12 ? 1 : fyMonth + 1;
      const targetDay   = fyDay;

      for (const title of ['closing the books', 'year end filling']) {
        const fyTask = await this.prisma.task.findFirst({
          where: { title, deletedAt: null },
        });
        if (!fyTask) continue;
        const fySchedule = await this.prisma.taskSchedule.findFirst({
          where: { companyId: company.id, taskId: fyTask.id, deletedAt: null },
        });
        if (!fySchedule) continue;

        await this.prisma.$executeRaw`
          UPDATE TaskSchedule
          SET cycleType = 'YEARLY',
              cycleDay  = ${targetDay},
              cycleNth  = ${targetMonth}
          WHERE id = ${fySchedule.id}
        `;
      }
    }

    return { id: company.id, businessName: company.businessName };
  }

  async findAll(userId: number, userRole: string) {
    const isAdmin = userRole === 'ADMIN';
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const twentyFiveDaysAgo = new Date(startOfToday);
    twentyFiveDaysAgo.setDate(twentyFiveDaysAgo.getDate() - 25);

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
          select: {
            id: true,
            dueDate: true,
            schedule: { select: { isImportant: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return companies.map(company => {
      const assignedUser = company.assignments[0]?.user ?? null;
      const totalTodos = company.todos.filter(
        t => !t.dueDate || t.dueDate <= startOfToday,
      ).length;
      const urgentTodos = company.todos.filter(
        t => t.dueDate !== null && t.dueDate < twentyFiveDaysAgo,
      ).length;
      const overdueTodos = company.todos.filter(
        t => t.dueDate !== null && t.dueDate >= twentyFiveDaysAgo && t.dueDate < startOfToday,
      ).length;
      const importantTodos = company.todos.filter(
        t => t.schedule?.isImportant,
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
        importantTodos,
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
