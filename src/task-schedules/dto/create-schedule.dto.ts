import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateScheduleDto {
  @IsInt()
  taskId: number;

  @IsInt()
  companyId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  cycle?: number;

  @IsOptional()
  @IsEnum(['DAYS', 'MONTHLY_DATE', 'WEEKLY_DAY', 'MONTHLY_WEEKDAY', 'QUARTERLY', 'YEARLY'])
  cycleType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  cycleDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  cycleNth?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
