import { Module } from '@nestjs/common';
import { PhoneSettingsController } from './phone-settings.controller.js';
import { PhoneSettingsService } from './phone-settings.service.js';

/**
 * Business hours and caller-facing messages.
 *
 * Deliberately its own module rather than a third controller inside `PhoneModule`. That
 * module already carries two controllers and six services under one very explicit rule —
 * *"Mixing guarded and unguarded routes in one class is how an unguarded one eventually
 * gets added by accident"* — and adding an ADMIN-only controller plus a service and four
 * DTOs pushes it past the point where that rule stays visible at a glance.
 *
 * `PhoneModule` imports this one for `effectiveFor()` on the inbound-call path. The
 * dependency runs ONE WAY: nothing here knows about `PhoneModule`, so there is no cycle.
 * PrismaModule and ConfigModule are global.
 */
@Module({
  controllers: [PhoneSettingsController],
  providers: [PhoneSettingsService],
  exports: [PhoneSettingsService],
})
export class PhoneSettingsModule {}
