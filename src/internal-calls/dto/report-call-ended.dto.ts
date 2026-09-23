import { IsBoolean, IsInt, Max, Min } from 'class-validator';

/**
 * A participant's browser reporting how the call it was on ended.
 *
 * Both fields come from the SIP session the browser actually held: `answered` is whether
 * it ever reached Established, `durationSec` how long it stayed there. The server refuses
 * the report unless the caller is a participant AND the row is still unsettled, so these
 * values can only ever fill in an outcome nobody else has supplied.
 */
export class ReportCallEndedDto {
  @IsBoolean()
  answered!: boolean;

  /**
   * Seconds of conversation. `Max` is 24 hours — not a real limit on a staff call, just
   * a bound so a broken clock cannot write a nonsense duration into the history.
   */
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSec!: number;
}
