import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultCycle?: number;

  @IsOptional()
  @IsEnum(['DAYS', 'MONTHLY_DATE', 'WEEKLY_DAY', 'MONTHLY_WEEKDAY'])
  defaultCycleType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  defaultCycleDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  defaultCycleNth?: number;

  @IsOptional()
  @IsBoolean()
  isImportant?: boolean;

  @IsOptional()
  @IsBoolean()
  canBeDisabled?: boolean;
}
