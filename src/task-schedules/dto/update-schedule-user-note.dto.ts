import { IsOptional, IsString } from 'class-validator';

export class UpdateScheduleUserNoteDto {
  @IsOptional()
  @IsString()
  note?: string;
}
