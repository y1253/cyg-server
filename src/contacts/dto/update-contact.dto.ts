import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Every field optional; an absent key means "leave alone". There is no `companyId` here —
 * a contact does not move between companies, and accepting one would be a way to hand
 * another company's caller a name of your choosing.
 */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
