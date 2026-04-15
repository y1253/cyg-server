import { IsInt, Min } from 'class-validator';

export class SetCycleDto {
  @IsInt()
  @Min(1)
  cycle: number;
}
