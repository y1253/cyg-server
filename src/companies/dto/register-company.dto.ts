import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
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
}
