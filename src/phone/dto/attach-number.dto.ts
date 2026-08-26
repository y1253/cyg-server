import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Body for attaching a specific number to a company.
 *
 * The E.164 check is not cosmetic: this value goes straight into a request that spends
 * money, and SignalWire's error for a malformed number is not something an admin should
 * have to interpret. The global ValidationPipe runs with `whitelist: true`, so any field
 * without a decorator here is silently stripped.
 */
export class AttachNumberDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneNumber must be E.164, e.g. +15145551234',
  })
  phoneNumber: string;

  /**
   * Province / state, carried over from the search result the admin picked. Purely
   * descriptive — SignalWire does not return a region on the purchase response, so this
   * is the only chance to record where the number is.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, {
    message: 'region must be a 2-letter code, e.g. QC',
  })
  region?: string;
}
