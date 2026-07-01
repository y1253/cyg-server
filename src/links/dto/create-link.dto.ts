import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class CreateLinkDto {
  @IsInt()
  companyId: number;

  @IsNotEmpty()
  @IsString()
  label: string;

  @IsUrl({ require_protocol: false })
  url: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
