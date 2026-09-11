import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsInt()
  companyId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * Accepted AS TYPED and normalised server-side. Deliberately NOT `@Matches(E164)` the
   * way `StartCallDto.to` is: that one is dialled, this one is filed. A number somebody
   * cannot write in E.164 (an extension, an overseas office) is still worth saving, it
   * just will not match an inbound call.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
