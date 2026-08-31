import { IsString, Matches } from 'class-validator';

/** Body for click-to-call. The caller ID is the company's own number, never sent. */
export class StartCallDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'to must be E.164, e.g. +15145551234',
  })
  to: string;
}
