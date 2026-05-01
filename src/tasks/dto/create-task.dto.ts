import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  isGeneral?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultCycle?: number;

  @IsOptional()
  @IsBoolean()
  isImportant?: boolean;
}
