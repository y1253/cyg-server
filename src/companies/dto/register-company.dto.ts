import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReconciliationAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsDateString()
  startDate: string;
}

export class CashFlowAccountDto {
  @IsString()
  accountName: string;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsDateString()
  startDate: string;

  @IsString()
  cycleType: string;

  @IsNumber()
  cycle: number;

  @IsOptional()
  @IsNumber()
  cycleDay?: number;

  @IsOptional()
  @IsNumber()
  cycleNth?: number;
}

export class CreditCardAccountDto {
  @IsString()
  accountName: string;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  statementDay?: number;

  @IsBoolean()
  limitEnabled: boolean;

  @IsOptional()
  @IsString()
  limitNote?: string;

  @IsOptional()
  @IsString()
  limitAmount?: string;

  @IsNumber()
  limitCycleDays: number;
}

export class RegisterCompanyDto {
  // QuickBooks
  @IsBoolean()
  hasQbAccount: boolean;

  @ValidateIf((o: RegisterCompanyDto) => o.hasQbAccount === false)
  @IsNotEmpty()
  @IsIn(['Essentials', 'Plus', 'Advanced'])
  qbPlan?: string;

  // Location
  @IsNotEmpty()
  @IsIn(['USA', 'CANADA'])
  country: string;

  // Company basics
  @IsNotEmpty()
  businessName: string;

  @IsOptional()
  @IsString()
  businessType?: string;

  @IsOptional()
  @IsString()
  companyType?: string;

  @IsOptional()
  @IsString()
  companyActivity?: string;

  // Contact info
  @IsOptional()
  @IsString()
  personalName?: string;

  @IsOptional()
  @IsString()
  privateEmail?: string;

  @IsOptional()
  @IsString()
  privatePhone?: string;

  @IsOptional()
  @IsString()
  storeNumber?: string;

  // Legal info (Canada only)
  @IsOptional()
  @IsString()
  neq?: string;

  @IsOptional()
  @IsString()
  revenueQcId?: string;

  @IsOptional()
  @IsString()
  craBn?: string;

  @IsOptional()
  @IsString()
  fiscalYear?: string;

  // Billing
  @IsOptional()
  @IsString()
  billingEmail?: string;

  @IsOptional()
  @IsString()
  billingPassword?: string;

  // Accountant
  @IsOptional()
  @IsString()
  accountantName?: string;

  @IsOptional()
  @IsString()
  accountantEmail?: string;

  @IsOptional()
  @IsString()
  accountantPhone?: string;

  // Reconciliation accounts
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconciliationAccountDto)
  reconciliationAccounts?: ReconciliationAccountDto[];

  // Accounts payable
  @IsOptional()
  @IsBoolean()
  apManageBills?: boolean;

  @ValidateIf((o: RegisterCompanyDto) => o.apManageBills === true)
  @IsDateString()
  apStartDate?: string;

  @IsOptional()
  @IsString()
  apCycleType?: string;

  @IsOptional()
  @IsNumber()
  apCycle?: number;

  @IsOptional()
  @IsNumber()
  apCycleDay?: number;

  @IsOptional()
  @IsNumber()
  apCycleNth?: number;

  // Accounts receivable — invoicing
  @IsOptional()
  @IsBoolean()
  arInvoicingEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  arInvoicingStartDate?: string;

  @IsOptional()
  @IsString()
  arInvoicingCycleType?: string;

  @IsOptional()
  @IsNumber()
  arInvoicingCycle?: number;

  @IsOptional()
  @IsNumber()
  arInvoicingCycleDay?: number;

  @IsOptional()
  @IsNumber()
  arInvoicingCycleNth?: number;

  @IsOptional()
  @IsString()
  arInvoicingNote?: string;

  // Accounts receivable — statements & notices
  @IsOptional()
  @IsBoolean()
  arStatementsEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  arStatementsStartDate?: string;

  @IsOptional()
  @IsString()
  arStatementsCycleType?: string;

  @IsOptional()
  @IsNumber()
  arStatementsCycle?: number;

  @IsOptional()
  @IsNumber()
  arStatementsCycleDay?: number;

  @IsOptional()
  @IsNumber()
  arStatementsCycleNth?: number;

  @IsOptional()
  @IsString()
  arStatementsNote?: string;

  // Accounts receivable — collection
  @IsOptional()
  @IsBoolean()
  arCollectionEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  arCollectionStartDate?: string;

  @IsOptional()
  @IsString()
  arCollectionCycleType?: string;

  @IsOptional()
  @IsNumber()
  arCollectionCycle?: number;

  @IsOptional()
  @IsNumber()
  arCollectionCycleDay?: number;

  @IsOptional()
  @IsNumber()
  arCollectionCycleNth?: number;

  @IsOptional()
  @IsString()
  arCollectionNote?: string;

  // Accounts receivable — open invoices report
  @IsOptional()
  @IsBoolean()
  arReportEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  arReportStartDate?: string;

  @IsOptional()
  @IsString()
  arReportCycleType?: string;

  @IsOptional()
  @IsNumber()
  arReportCycle?: number;

  @IsOptional()
  @IsNumber()
  arReportCycleDay?: number;

  @IsOptional()
  @IsNumber()
  arReportCycleNth?: number;

  @IsOptional()
  @IsString()
  arReportNote?: string;

  // Payroll management (all companies)
  @IsOptional()
  @IsBoolean()
  payrollEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  payrollStartDate?: string;

  @IsOptional()
  @IsString()
  payrollCycleType?: string;

  @IsOptional()
  @IsNumber()
  payrollCycle?: number;

  @IsOptional()
  @IsNumber()
  payrollCycleDay?: number;

  @IsOptional()
  @IsNumber()
  payrollCycleNth?: number;

  @IsOptional()
  @IsString()
  payrollNote?: string;

  // Payroll tax filing (Canada only)
  @IsOptional()
  @IsBoolean()
  payrollTaxEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  payrollTaxCadEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  payrollTaxQcEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  payrollTaxStartDate?: string;

  @IsOptional()
  @IsString()
  payrollTaxCycleType?: string;

  @IsOptional()
  @IsNumber()
  payrollTaxCycle?: number;

  @IsOptional()
  @IsNumber()
  payrollTaxCycleDay?: number;

  @IsOptional()
  @IsNumber()
  payrollTaxCycleNth?: number;

  @IsOptional()
  @IsString()
  payrollTaxNote?: string;

  @IsOptional()
  @IsDateString()
  payrollTaxQcStartDate?: string;

  @IsOptional()
  @IsString()
  payrollTaxQcCycleType?: string;

  @IsOptional()
  @IsNumber()
  payrollTaxQcCycle?: number;

  @IsOptional()
  @IsNumber()
  payrollTaxQcCycleDay?: number;

  @IsOptional()
  @IsNumber()
  payrollTaxQcCycleNth?: number;

  @IsOptional()
  @IsString()
  payrollTaxQcNote?: string;

  // Payroll year-end (Canada only)
  @IsOptional()
  @IsBoolean()
  payrollYearEndEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  payrollYearEndRl1?: boolean;

  @IsOptional()
  @IsBoolean()
  payrollYearEndT4?: boolean;

  @IsOptional()
  @IsBoolean()
  payrollYearEndCnesst?: boolean;

  // General step — location visit
  @IsOptional()
  @IsBoolean()
  locationVisitEnabled?: boolean;

  @IsOptional()
  @IsString()
  locationVisitFrequency?: string;

  // General step — Canadian document/tax schedules
  @IsOptional()
  @IsBoolean()
  qcDocsEnabled?: boolean;

  @IsOptional()
  @IsString()
  qcDocsNote?: string;

  @IsOptional()
  @IsBoolean()
  craDocsEnabled?: boolean;

  @IsOptional()
  @IsString()
  craDocsNote?: string;

  @IsOptional()
  @IsBoolean()
  salesTaxEnabled?: boolean;

  @IsOptional()
  @IsString()
  salesTaxNote?: string;

  // Secretarial — cash flow management (per-account)
  @IsOptional()
  @IsBoolean()
  cashFlowEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CashFlowAccountDto)
  cashFlowAccounts?: CashFlowAccountDto[];

  // Secretarial — credit card management (per-account)
  @IsOptional()
  @IsBoolean()
  creditCardEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditCardAccountDto)
  creditCardAccounts?: CreditCardAccountDto[];

  // Secretarial — receipt tracking
  @IsOptional()
  @IsBoolean()
  receiptTrackingEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  receiptTrackingStartDate?: string;

  @IsOptional()
  @IsString()
  receiptTrackingCycleType?: string;

  @IsOptional()
  @IsNumber()
  receiptTrackingCycle?: number;

  @IsOptional()
  @IsNumber()
  receiptTrackingCycleDay?: number;

  @IsOptional()
  @IsNumber()
  receiptTrackingCycleNth?: number;

  @IsOptional()
  @IsString()
  receiptTrackingNote?: string;

  @IsOptional()
  @IsString()
  cardHolderName?: string;

  @IsOptional()
  @IsString()
  cardNumber?: string;

  @IsOptional()
  @IsString()
  cardExpiry?: string;

  @IsOptional()
  @IsString()
  cardCvv?: string;
}
