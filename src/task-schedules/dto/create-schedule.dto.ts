import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

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
  @IsEnum([
    'DAYS',
    'MONTHLY_DATE',
    'WEEKLY_DAY',
    'MONTHLY_WEEKDAY',
    'QUARTERLY',
    'YEARLY',
  ])
  cycleType?: string;

  @IsOptional()
  @IsInt()
  @Min(0) // 0 = last day of month (sentinel); 1–28 = specific day
  @Max(28)
  cycleDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  cycleNth?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
