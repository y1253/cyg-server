import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateLinkDto {
  @IsInt()
  companyId: number;

  @IsNotEmpty()
  @IsString()
  label: string;

  @IsUrl({ require_protocol: false })
  @MaxLength(2048)
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
