import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertScheduleNoteDto {
  @IsString()
  @IsNotEmpty()
  note: string;
}
