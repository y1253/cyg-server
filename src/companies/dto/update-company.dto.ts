import { IsOptional, IsString } from 'class-validator';

export class UpdateCompanyDto {
  // Company root
  @IsOptional() @IsString() supportNumber?: string;
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() businessType?: string;
  @IsOptional() @IsString() companyType?: string;
  @IsOptional() @IsString() companyActivity?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() qbPlan?: string;
  // Contact
  @IsOptional() @IsString() personalName?: string;
  @IsOptional() @IsString() privateEmail?: string;
  @IsOptional() @IsString() privatePhone?: string;
  @IsOptional() @IsString() storeNumber?: string;
  // Legal
  @IsOptional() @IsString() neq?: string;
  @IsOptional() @IsString() revenueQcId?: string;
  @IsOptional() @IsString() craBn?: string;
  @IsOptional() @IsString()     fiscalYear?: string;
  // Accountant
  @IsOptional() @IsString() accountantName?: string;
  @IsOptional() @IsString() accountantEmail?: string;
  @IsOptional() @IsString() accountantPhone?: string;
  // Billing
  @IsOptional() @IsString() billingEmail?: string;
  @IsOptional() @IsString() billingPassword?: string;
}
