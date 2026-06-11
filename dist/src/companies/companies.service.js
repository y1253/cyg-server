"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompaniesService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const compute_next_due_js_1 = require("../task-schedules/compute-next-due.js");
const ALGORITHM = 'aes-256-cbc';
function encrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}
function decrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const [ivHex, encHex] = text.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(encHex, 'hex')),
        decipher.final(),
    ]).toString('utf8');
}
let CompaniesService = class CompaniesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async backfillOrCreateTodos(scheduleId, taskId, companyId, startDate, args) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().slice(0, 10);
        const sdStr = startDate.toISOString().slice(0, 10);
        if (sdStr <= todayStr) {
            let nextDue = (0, compute_next_due_js_1.computeFirstDue)(startDate, args);
            while (nextDue <= today) {
                await this.prisma.todo.create({
                    data: { taskId, companyId, scheduleId, dueDate: nextDue },
                });
                nextDue = (0, compute_next_due_js_1.computeNextDue)(nextDue, args);
            }
            await this.prisma.todo.create({
                data: { taskId, companyId, scheduleId, dueDate: nextDue },
            });
        }
        else {
            const firstDue = (0, compute_next_due_js_1.computeFirstDue)(startDate, args);
            await this.prisma.todo.create({
                data: { taskId, companyId, scheduleId, dueDate: firstDue },
            });
        }
    }
    async register(dto) {
        const encKey = process.env.ENCRYPTION_KEY;
        if (!encKey)
            throw new Error('ENCRYPTION_KEY not set');
        const qbTaskTitle = dto.hasQbAccount
            ? 'Follow up: Verify QuickBooks invite sent'
            : `Open QuickBooks Online ${dto.qbPlan}`;
        const qbTask = await this.prisma.task.findUnique({ where: { title: qbTaskTitle } });
        if (!qbTask) {
            throw new common_1.BadRequestException(`QB task not found: "${qbTaskTitle}". Run the seed first.`);
        }
        const hasContact = dto.personalName || dto.privateEmail || dto.privatePhone || dto.storeNumber;
        const hasLegal = dto.country === 'CANADA' && (dto.neq || dto.revenueQcId || dto.craBn || dto.fiscalYear);
        const hasBilling = !!dto.billingEmail;
        const hasAccountant = !!dto.accountantName;
        const encryptedBillingPassword = hasBilling && dto.billingPassword ? encrypt(dto.billingPassword, encKey) : undefined;
        const company = await this.prisma.company.create({
            data: {
                businessName: dto.businessName,
                businessType: dto.businessType,
                companyType: dto.companyType,
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
        if (dto.locationVisitEnabled === true) {
            const freq = dto.locationVisitFrequency === 'monthly' ? 'Monthly' : 'Quarterly';
            await this.prisma.companyNote.create({
                data: { companyId: company.id, content: `Location visit requested: ${freq}` },
            });
        }
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
        const reconciliationTask = await this.prisma.task.findFirst({
            where: { title: 'Reconciliation', deletedAt: null },
        });
        const generalTasks = await this.prisma.task.findMany({
            where: {
                isGeneral: true,
                deletedAt: null,
                ...(reconciliationTask ? { id: { not: reconciliationTask.id } } : {}),
            },
        });
        const generalToday = new Date();
        generalToday.setHours(0, 0, 0, 0);
        for (const task of generalTasks) {
            const cycle = task.defaultCycle;
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + cycle);
            const genSchedule = await this.prisma.taskSchedule.create({
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
            await this.prisma.$executeRaw `
        UPDATE TaskSchedule SET startDate = ${generalToday} WHERE id = ${genSchedule.id}
      `;
        }
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
                    }
                    else {
                        const cycleType = dto.apCycleType ?? 'DAYS';
                        const startDate = dto.apStartDate ? new Date(dto.apStartDate) : new Date();
                        const cycleVal = dto.apCycle ?? 30;
                        await this.prisma.taskSchedule.update({
                            where: { id: apSchedule.id },
                            data: { cycle: cycleVal, note: dto.apNote ?? null },
                        });
                        await this.prisma.$executeRaw `
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
                        await this.backfillOrCreateTodos(apSchedule.id, apTask.id, company.id, startDate, {
                            cycle: cycleVal,
                            cycleType,
                            cycleDay: dto.apCycleDay ?? null,
                            cycleNth: dto.apCycleNth ?? null,
                        });
                    }
                }
            }
        }
        const arRules = [
            {
                title: 'invoicing',
                enabled: dto.arInvoicingEnabled,
                cycleType: dto.arInvoicingCycleType,
                cycle: dto.arInvoicingCycle,
                cycleDay: dto.arInvoicingCycleDay,
                cycleNth: dto.arInvoicingCycleNth,
                note: dto.arInvoicingNote,
                startDate: dto.arInvoicingStartDate,
            },
            {
                title: 'account receivable statement',
                enabled: dto.arStatementsEnabled,
                cycleType: dto.arStatementsCycleType,
                cycle: dto.arStatementsCycle,
                cycleDay: dto.arStatementsCycleDay,
                cycleNth: dto.arStatementsCycleNth,
                note: dto.arStatementsNote,
                startDate: dto.arStatementsStartDate,
            },
            {
                title: 'account receivable management',
                enabled: dto.arCollectionEnabled,
                cycleType: dto.arCollectionCycleType,
                cycle: dto.arCollectionCycle,
                cycleDay: dto.arCollectionCycleDay,
                cycleNth: dto.arCollectionCycleNth,
                note: dto.arCollectionNote,
                startDate: dto.arCollectionStartDate,
            },
            {
                title: 'account receivable report',
                enabled: dto.arReportEnabled,
                cycleType: dto.arReportCycleType,
                cycle: dto.arReportCycle,
                cycleDay: dto.arReportCycleDay,
                cycleNth: dto.arReportCycleNth,
                note: dto.arReportNote,
                startDate: dto.arReportStartDate,
            },
        ];
        for (const rule of arRules) {
            if (rule.enabled === undefined)
                continue;
            const arTask = await this.prisma.task.findFirst({
                where: { title: rule.title, isGeneral: true, deletedAt: null },
            });
            if (!arTask)
                continue;
            const arSchedule = await this.prisma.taskSchedule.findFirst({
                where: { taskId: arTask.id, companyId: company.id, deletedAt: null },
            });
            if (!arSchedule)
                continue;
            if (rule.enabled === false) {
                await this.prisma.taskSchedule.update({
                    where: { id: arSchedule.id },
                    data: { deletedAt: new Date() },
                });
                await this.prisma.todo.deleteMany({
                    where: { scheduleId: arSchedule.id, resolved: false },
                });
            }
            else {
                const cycleType = rule.cycleType ?? 'DAYS';
                const cycleVal = rule.cycle ?? 30;
                const sd = rule.startDate ? new Date(rule.startDate) : new Date();
                await this.prisma.taskSchedule.update({
                    where: { id: arSchedule.id },
                    data: { cycle: cycleVal, note: rule.note || null },
                });
                await this.prisma.$executeRaw `
          UPDATE TaskSchedule
          SET cycleType = ${cycleType},
              cycleDay  = ${rule.cycleDay ?? null},
              cycleNth  = ${rule.cycleNth ?? null},
              startDate = ${sd}
          WHERE id = ${arSchedule.id}
        `;
                if (sd) {
                    await this.prisma.todo.deleteMany({ where: { scheduleId: arSchedule.id, resolved: false } });
                    await this.backfillOrCreateTodos(arSchedule.id, arTask.id, company.id, sd, {
                        cycle: cycleVal,
                        cycleType,
                        cycleDay: rule.cycleDay ?? null,
                        cycleNth: rule.cycleNth ?? null,
                    });
                }
            }
        }
        if (dto.reconciliationAccounts && dto.reconciliationAccounts.length > 0) {
            if (reconciliationTask) {
                const reconcToday = new Date();
                reconcToday.setHours(0, 0, 0, 0);
                for (let i = 0; i < dto.reconciliationAccounts.length; i++) {
                    const account = dto.reconciliationAccounts[i];
                    const startDate = new Date(account.startDate);
                    const note = `${account.name} - ${account.type}`;
                    const isManuallyAdded = i === 0 ? 0 : 1;
                    const schedule = await this.prisma.taskSchedule.create({
                        data: {
                            taskId: reconciliationTask.id,
                            companyId: company.id,
                            cycle: 30,
                            note,
                            isImportant: reconciliationTask.isImportant,
                        },
                    });
                    await this.prisma.$executeRaw `
            UPDATE TaskSchedule
            SET cycleType = 'DAYS', isManuallyAdded = ${isManuallyAdded}, startDate = ${startDate}
            WHERE id = ${schedule.id}
          `;
                    let dueDate = new Date(startDate);
                    dueDate.setDate(dueDate.getDate() + 30);
                    while (dueDate <= reconcToday) {
                        await this.prisma.todo.create({
                            data: { taskId: reconciliationTask.id, companyId: company.id, scheduleId: schedule.id, dueDate: new Date(dueDate) },
                        });
                        dueDate.setDate(dueDate.getDate() + 30);
                    }
                    await this.prisma.todo.create({
                        data: { taskId: reconciliationTask.id, companyId: company.id, scheduleId: schedule.id, dueDate: new Date(dueDate) },
                    });
                }
            }
        }
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
                    }
                    else {
                        const cycleType = dto.payrollCycleType ?? 'DAYS';
                        const cycleVal = dto.payrollCycle ?? 30;
                        const payrollSd = dto.payrollStartDate ? new Date(dto.payrollStartDate) : new Date();
                        await this.prisma.taskSchedule.update({
                            where: { id: payrollSchedule.id },
                            data: { cycle: cycleVal, note: dto.payrollNote || null },
                        });
                        await this.prisma.$executeRaw `
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${dto.payrollCycleDay ?? null},
                  cycleNth  = ${dto.payrollCycleNth ?? null},
                  startDate = ${payrollSd}
              WHERE id = ${payrollSchedule.id}
            `;
                        await this.prisma.todo.deleteMany({
                            where: { scheduleId: payrollSchedule.id, resolved: false },
                        });
                        await this.backfillOrCreateTodos(payrollSchedule.id, payrollTask.id, company.id, payrollSd, {
                            cycle: cycleVal,
                            cycleType,
                            cycleDay: dto.payrollCycleDay ?? null,
                            cycleNth: dto.payrollCycleNth ?? null,
                        });
                    }
                }
            }
        }
        if (dto.country === 'CANADA') {
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
                        if (!s)
                            continue;
                        await this.prisma.taskSchedule.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
                        await this.prisma.todo.deleteMany({ where: { scheduleId: s.id, resolved: false } });
                    }
                }
                else if (dto.payrollTaxEnabled === true) {
                    if (dto.payrollTaxCadEnabled && cadSchedule && cadTask) {
                        const cycleType = 'DAYS';
                        const cycleVal = 1;
                        const taxSd = new Date();
                        await this.prisma.taskSchedule.update({
                            where: { id: cadSchedule.id },
                            data: { cycle: cycleVal, note: dto.payrollTaxNote || null },
                        });
                        await this.prisma.$executeRaw `
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${null},
                  cycleNth  = ${null},
                  startDate = ${taxSd}
              WHERE id = ${cadSchedule.id}
            `;
                        await this.prisma.todo.deleteMany({ where: { scheduleId: cadSchedule.id, resolved: false } });
                        await this.backfillOrCreateTodos(cadSchedule.id, cadTask.id, company.id, taxSd, {
                            cycle: cycleVal, cycleType,
                            cycleDay: null,
                            cycleNth: null,
                        });
                    }
                    else if (cadSchedule) {
                        await this.prisma.taskSchedule.update({ where: { id: cadSchedule.id }, data: { deletedAt: new Date() } });
                        await this.prisma.todo.deleteMany({ where: { scheduleId: cadSchedule.id, resolved: false } });
                    }
                    if (dto.payrollTaxQcEnabled && qcSchedule && qcTask) {
                        const cycleType = 'DAYS';
                        const cycleVal = 1;
                        const taxSd = new Date();
                        await this.prisma.taskSchedule.update({
                            where: { id: qcSchedule.id },
                            data: { cycle: cycleVal, note: dto.payrollTaxQcNote || null },
                        });
                        await this.prisma.$executeRaw `
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${null},
                  cycleNth  = ${null},
                  startDate = ${taxSd}
              WHERE id = ${qcSchedule.id}
            `;
                        await this.prisma.todo.deleteMany({ where: { scheduleId: qcSchedule.id, resolved: false } });
                        await this.backfillOrCreateTodos(qcSchedule.id, qcTask.id, company.id, taxSd, {
                            cycle: cycleVal, cycleType,
                            cycleDay: null,
                            cycleNth: null,
                        });
                    }
                    else if (qcSchedule) {
                        await this.prisma.taskSchedule.update({ where: { id: qcSchedule.id }, data: { deletedAt: new Date() } });
                        await this.prisma.todo.deleteMany({ where: { scheduleId: qcSchedule.id, resolved: false } });
                    }
                    if (dto.payrollTaxCadEnabled || dto.payrollTaxQcEnabled) {
                        await this.prisma.companyNote.create({
                            data: { companyId: company.id, content: 'QC and CAD and sales tax need to be modified' },
                        });
                    }
                }
            }
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
                    if (!task)
                        continue;
                    const schedule = await this.prisma.taskSchedule.findFirst({
                        where: { taskId: task.id, companyId: company.id, deletedAt: null },
                    });
                    if (!schedule)
                        continue;
                    const shouldEnable = dto.payrollYearEndEnabled === true && entry.enabled;
                    if (!shouldEnable) {
                        await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { deletedAt: new Date() } });
                        await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
                    }
                    else {
                        await this.prisma.$executeRaw `
              UPDATE TaskSchedule
              SET cycleType = 'YEARLY',
                  cycleDay  = 15,
                  cycleNth  = 1
              WHERE id = ${schedule.id}
            `;
                        await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
                        const firstDue = (0, compute_next_due_js_1.computeFirstDue)(new Date(), {
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
            const canadianDocRules = [
                { title: 'Quebec Gov. documents and balances', enabled: dto.qcDocsEnabled, note: dto.qcDocsNote },
                { title: 'CRA Gov. documents and balances', enabled: dto.craDocsEnabled, note: dto.craDocsNote },
                { title: 'Sales tax filing', enabled: dto.salesTaxEnabled, note: dto.salesTaxNote },
            ];
            for (const rule of canadianDocRules) {
                if (rule.enabled === undefined)
                    continue;
                const task = await this.prisma.task.findFirst({ where: { title: rule.title, isGeneral: true, deletedAt: null } });
                if (!task)
                    continue;
                const schedule = await this.prisma.taskSchedule.findFirst({ where: { taskId: task.id, companyId: company.id, deletedAt: null } });
                if (!schedule)
                    continue;
                if (rule.enabled === false) {
                    await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { deletedAt: new Date() } });
                    await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
                }
                else {
                    await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { note: rule.note || null } });
                }
            }
        }
        else {
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
                if (!task)
                    continue;
                const schedule = await this.prisma.taskSchedule.findFirst({
                    where: { taskId: task.id, companyId: company.id, deletedAt: null },
                });
                if (!schedule)
                    continue;
                await this.prisma.taskSchedule.update({ where: { id: schedule.id }, data: { deletedAt: new Date() } });
                await this.prisma.todo.deleteMany({ where: { scheduleId: schedule.id, resolved: false } });
            }
        }
        if (dto.cashFlowEnabled !== undefined) {
            for (const title of ['Cash flow management', 'Daily cash flow']) {
                const cfTask = await this.prisma.task.findFirst({ where: { title, deletedAt: null } });
                if (!cfTask)
                    continue;
                const existingSchedules = await this.prisma.taskSchedule.findMany({
                    where: { taskId: cfTask.id, companyId: company.id, deletedAt: null },
                });
                for (const s of existingSchedules) {
                    await this.prisma.taskSchedule.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
                    await this.prisma.todo.deleteMany({ where: { scheduleId: s.id, resolved: false } });
                }
                if (dto.cashFlowEnabled === true && dto.cashFlowAccounts) {
                    const enabled = dto.cashFlowAccounts.filter(a => a.enabled);
                    const baseSchedule = existingSchedules[0] ?? null;
                    for (let i = 0; i < enabled.length; i++) {
                        const account = enabled[i];
                        const note = [account.accountName, account.note || ''].filter(Boolean).join('\n');
                        const cycleType = account.cycleType ?? 'DAYS';
                        const cycleVal = account.cycle ?? 30;
                        const sd = account.startDate ? new Date(account.startDate) : new Date();
                        if (i === 0 && baseSchedule) {
                            await this.prisma.taskSchedule.update({
                                where: { id: baseSchedule.id },
                                data: { deletedAt: null, cycle: cycleVal, note },
                            });
                            await this.prisma.$executeRaw `
                UPDATE TaskSchedule
                SET cycleType = ${cycleType},
                    cycleDay  = ${account.cycleDay ?? null},
                    cycleNth  = ${account.cycleNth ?? null},
                    startDate = ${sd},
                    isManuallyAdded = 0
                WHERE id = ${baseSchedule.id}
              `;
                            await this.backfillOrCreateTodos(baseSchedule.id, cfTask.id, company.id, sd, {
                                cycle: cycleVal, cycleType,
                                cycleDay: account.cycleDay ?? null,
                                cycleNth: account.cycleNth ?? null,
                            });
                        }
                        else {
                            const newSchedule = await this.prisma.taskSchedule.create({
                                data: { taskId: cfTask.id, companyId: company.id, cycle: cycleVal, note, isImportant: cfTask.isImportant },
                            });
                            await this.prisma.$executeRaw `
                UPDATE TaskSchedule
                SET cycleType = ${cycleType},
                    cycleDay  = ${account.cycleDay ?? null},
                    cycleNth  = ${account.cycleNth ?? null},
                    startDate = ${sd},
                    isManuallyAdded = 1
                WHERE id = ${newSchedule.id}
              `;
                            await this.backfillOrCreateTodos(newSchedule.id, cfTask.id, company.id, sd, {
                                cycle: cycleVal, cycleType,
                                cycleDay: account.cycleDay ?? null,
                                cycleNth: account.cycleNth ?? null,
                            });
                        }
                    }
                }
            }
        }
        if (dto.creditCardEnabled !== undefined) {
            const ccTask = await this.prisma.task.findFirst({
                where: { title: 'Credit Card Management', deletedAt: null },
            });
            if (ccTask) {
                const existingCcSchedules = await this.prisma.taskSchedule.findMany({
                    where: { taskId: ccTask.id, companyId: company.id, deletedAt: null },
                });
                for (const s of existingCcSchedules) {
                    await this.prisma.taskSchedule.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
                    await this.prisma.todo.deleteMany({ where: { scheduleId: s.id, resolved: false } });
                }
                if (dto.creditCardEnabled === true && dto.creditCardAccounts) {
                    const enabled = dto.creditCardAccounts.filter(a => a.enabled);
                    const baseSchedule = existingCcSchedules[0] ?? null;
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    for (let i = 0; i < enabled.length; i++) {
                        const account = enabled[i];
                        const statDay = account.statementDay ?? 1;
                        const cycleDay = Math.min(statDay + 5, 31);
                        const note = [account.accountName, account.note || ''].filter(Boolean).join('\n');
                        if (i === 0 && baseSchedule) {
                            await this.prisma.taskSchedule.update({
                                where: { id: baseSchedule.id },
                                data: { deletedAt: null, cycle: 1, note },
                            });
                            await this.prisma.$executeRaw `
                UPDATE TaskSchedule
                SET cycleType = 'MONTHLY_DATE',
                    cycleDay  = ${cycleDay},
                    cycleNth  = null,
                    startDate = ${today},
                    isManuallyAdded = 0
                WHERE id = ${baseSchedule.id}
              `;
                            await this.backfillOrCreateTodos(baseSchedule.id, ccTask.id, company.id, today, {
                                cycle: 1, cycleType: 'MONTHLY_DATE', cycleDay, cycleNth: null,
                            });
                        }
                        else {
                            const newSchedule = await this.prisma.taskSchedule.create({
                                data: { taskId: ccTask.id, companyId: company.id, cycle: 1, note, isImportant: ccTask.isImportant },
                            });
                            await this.prisma.$executeRaw `
                UPDATE TaskSchedule
                SET cycleType = 'MONTHLY_DATE',
                    cycleDay  = ${cycleDay},
                    cycleNth  = null,
                    startDate = ${today},
                    isManuallyAdded = 1
                WHERE id = ${newSchedule.id}
              `;
                            await this.backfillOrCreateTodos(newSchedule.id, ccTask.id, company.id, today, {
                                cycle: 1, cycleType: 'MONTHLY_DATE', cycleDay, cycleNth: null,
                            });
                        }
                        if (account.limitEnabled) {
                            const limitNote = [
                                account.accountName,
                                account.limitAmount || '',
                                account.limitNote || '',
                            ].filter(Boolean).join('\n');
                            const limitSchedule = await this.prisma.taskSchedule.create({
                                data: { taskId: ccTask.id, companyId: company.id, cycle: account.limitCycleDays ?? 1, note: limitNote, isImportant: ccTask.isImportant },
                            });
                            await this.prisma.$executeRaw `
                UPDATE TaskSchedule
                SET cycleType = 'DAYS',
                    cycleDay  = null,
                    cycleNth  = null,
                    startDate = ${today},
                    isManuallyAdded = 1
                WHERE id = ${limitSchedule.id}
              `;
                            await this.backfillOrCreateTodos(limitSchedule.id, ccTask.id, company.id, today, {
                                cycle: account.limitCycleDays ?? 1, cycleType: 'DAYS', cycleDay: null, cycleNth: null,
                            });
                        }
                    }
                }
            }
        }
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
                    }
                    else {
                        const cycleType = dto.receiptTrackingCycleType ?? 'DAYS';
                        const cycleVal = dto.receiptTrackingCycle ?? 30;
                        const rtSd = dto.receiptTrackingStartDate ? new Date(dto.receiptTrackingStartDate) : new Date();
                        await this.prisma.taskSchedule.update({
                            where: { id: rtSchedule.id },
                            data: { cycle: cycleVal, note: dto.receiptTrackingNote || null },
                        });
                        await this.prisma.$executeRaw `
              UPDATE TaskSchedule
              SET cycleType = ${cycleType},
                  cycleDay  = ${dto.receiptTrackingCycleDay ?? null},
                  cycleNth  = ${dto.receiptTrackingCycleNth ?? null},
                  startDate = ${rtSd}
              WHERE id = ${rtSchedule.id}
            `;
                        if (rtSd) {
                            await this.prisma.todo.deleteMany({ where: { scheduleId: rtSchedule.id, resolved: false } });
                            await this.backfillOrCreateTodos(rtSchedule.id, rtTask.id, company.id, rtSd, {
                                cycle: cycleVal,
                                cycleType,
                                cycleDay: dto.receiptTrackingCycleDay ?? null,
                                cycleNth: dto.receiptTrackingCycleNth ?? null,
                            });
                        }
                    }
                }
            }
        }
        if (dto.cardNumber) {
            await this.prisma.companyNote.create({
                data: {
                    companyId: company.id,
                    content: `Card on file — Name: ${dto.cardHolderName}, Card: ${dto.cardNumber}, Expiry: ${dto.cardExpiry}, CVV: ${dto.cardCvv}`,
                },
            });
        }
        if (dto.fiscalYear) {
            const parts = dto.fiscalYear.split('-');
            const fyMonth = parseInt(parts[1], 10);
            const fyDay = parseInt(parts[2], 10);
            const targetMonth = fyMonth === 12 ? 1 : fyMonth + 1;
            const targetDay = fyDay;
            for (const title of ['closing the books', 'year end filling']) {
                const fyTask = await this.prisma.task.findFirst({
                    where: { title, deletedAt: null },
                });
                if (!fyTask)
                    continue;
                const fySchedule = await this.prisma.taskSchedule.findFirst({
                    where: { companyId: company.id, taskId: fyTask.id, deletedAt: null },
                });
                if (!fySchedule)
                    continue;
                await this.prisma.$executeRaw `
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
    async findAll(userId, userRole) {
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
                        snoozedUntil: true,
                        schedule: { select: { isImportant: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return companies.map(company => {
            const assignedUser = company.assignments[0]?.user ?? null;
            const now = new Date();
            const openTodos = company.todos.filter(t => !t.snoozedUntil || t.snoozedUntil <= now);
            const totalTodos = openTodos.filter(t => !t.dueDate || t.dueDate <= startOfToday).length;
            const urgentTodos = openTodos.filter(t => t.dueDate !== null && t.dueDate < twentyFiveDaysAgo).length;
            const overdueTodos = openTodos.filter(t => t.dueDate !== null && t.dueDate >= twentyFiveDaysAgo && t.dueDate < startOfToday).length;
            const importantTodos = openTodos.filter(t => t.schedule?.isImportant && (!t.dueDate || t.dueDate <= startOfToday)).length;
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
    async findOne(id, userId, userRole) {
        const isAdmin = userRole === 'ADMIN';
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const encKey = process.env.ENCRYPTION_KEY;
        const company = await this.prisma.company.findFirst({
            where: {
                id,
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
                    include: { task: { select: { id: true, title: true, description: true, isSnoozable: true, orderNumber: true } } },
                    orderBy: [{ resolved: 'asc' }, { dueDate: 'asc' }],
                },
            },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        const assignedUser = company.assignments[0]?.user ?? null;
        const billing = isAdmin && company.billing
            ? {
                billingEmail: company.billing.billingEmail,
                billingPassword: company.billing.billingPassword && encKey
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
    async update(id, dto) {
        const company = await this.prisma.company.findFirst({
            where: { id, deletedAt: null },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        const encKey = process.env.ENCRYPTION_KEY;
        try {
            await this.prisma.company.update({
                where: { id },
                data: {
                    ...(dto.businessName !== undefined && { businessName: dto.businessName }),
                    ...(dto.businessType !== undefined && { businessType: dto.businessType }),
                    ...(dto.companyType !== undefined && { companyType: dto.companyType }),
                    ...(dto.companyActivity !== undefined && { companyActivity: dto.companyActivity }),
                    ...(dto.country !== undefined && { country: dto.country }),
                    ...(dto.qbPlan !== undefined && { qbPlan: dto.qbPlan }),
                    ...(dto.supportNumber !== undefined && { supportNumber: dto.supportNumber || null }),
                },
            });
            const hasContact = [dto.personalName, dto.privateEmail, dto.privatePhone, dto.storeNumber]
                .some(v => v !== undefined);
            if (hasContact) {
                await this.prisma.contactInfo.upsert({
                    where: { companyId: id },
                    create: { companyId: id, personalName: dto.personalName, privateEmail: dto.privateEmail,
                        privatePhone: dto.privatePhone, storeNumber: dto.storeNumber },
                    update: {
                        ...(dto.personalName !== undefined && { personalName: dto.personalName }),
                        ...(dto.privateEmail !== undefined && { privateEmail: dto.privateEmail }),
                        ...(dto.privatePhone !== undefined && { privatePhone: dto.privatePhone }),
                        ...(dto.storeNumber !== undefined && { storeNumber: dto.storeNumber }),
                    },
                });
            }
            const hasLegal = [dto.neq, dto.revenueQcId, dto.craBn, dto.fiscalYear]
                .some(v => v !== undefined);
            if (hasLegal) {
                await this.prisma.legalInfo.upsert({
                    where: { companyId: id },
                    create: { companyId: id, neq: dto.neq, revenueQcId: dto.revenueQcId, craBn: dto.craBn,
                        fiscalYear: dto.fiscalYear },
                    update: {
                        ...(dto.neq !== undefined && { neq: dto.neq }),
                        ...(dto.revenueQcId !== undefined && { revenueQcId: dto.revenueQcId }),
                        ...(dto.craBn !== undefined && { craBn: dto.craBn }),
                        ...(dto.fiscalYear !== undefined && { fiscalYear: dto.fiscalYear || null }),
                    },
                });
            }
            const hasAccountant = [dto.accountantName, dto.accountantEmail, dto.accountantPhone]
                .some(v => v !== undefined);
            if (hasAccountant) {
                await this.prisma.accountant.upsert({
                    where: { companyId: id },
                    create: { companyId: id, name: dto.accountantName, email: dto.accountantEmail,
                        phone: dto.accountantPhone },
                    update: {
                        ...(dto.accountantName !== undefined && { name: dto.accountantName }),
                        ...(dto.accountantEmail !== undefined && { email: dto.accountantEmail }),
                        ...(dto.accountantPhone !== undefined && { phone: dto.accountantPhone }),
                    },
                });
            }
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
                        ...(encryptedPw !== undefined && { billingPassword: encryptedPw }),
                    },
                });
            }
            return { id };
        }
        catch (err) {
            if (err?.code === 'P2002') {
                throw new common_1.ConflictException('This support number is already assigned to another company');
            }
            throw err;
        }
    }
    async remove(id) {
        const company = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
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
    async restore(id) {
        const company = await this.prisma.company.findFirst({ where: { id, deletedAt: { not: null } } });
        if (!company)
            throw new common_1.NotFoundException('Deleted company not found');
        await this.prisma.company.update({ where: { id }, data: { deletedAt: null } });
        return { id };
    }
    async permanentDelete(id) {
        const company = await this.prisma.company.findFirst({ where: { id, deletedAt: { not: null } } });
        if (!company)
            throw new common_1.NotFoundException('Deleted company not found');
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
    async assignUser(companyId, userId) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        await this.prisma.assignment.deleteMany({ where: { companyId } });
        if (userId !== null) {
            const user = await this.prisma.user.findFirst({
                where: { id: userId, deletedAt: null },
            });
            if (!user)
                throw new common_1.NotFoundException('User not found');
            await this.prisma.assignment.create({ data: { companyId, userId } });
        }
        return { ok: true };
    }
};
exports.CompaniesService = CompaniesService;
exports.CompaniesService = CompaniesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], CompaniesService);
//# sourceMappingURL=companies.service.js.map