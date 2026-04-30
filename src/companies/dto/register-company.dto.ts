import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

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
}
