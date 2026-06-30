import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateScheduleDto {
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
  cycleDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  cycleNth?: number | null;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;
}
