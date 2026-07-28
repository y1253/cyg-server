import { Module, OnModuleInit } from '@nestjs/common';
import { InternalMessagesController } from './internal-messages.controller.js';
import { InternalMessagesService } from './internal-messages.service.js';
import { ensureUploadDirs } from './uploads.js';

@Module({
  controllers: [InternalMessagesController],
  providers: [InternalMessagesService],
  // CommunicationsModule injects the service to fold the internal uncompleted
  // count into the dashboard's per-company badge map.
  exports: [InternalMessagesService],
})
export class InternalMessagesModule implements OnModuleInit {
  onModuleInit() {
    // Create the uploads tree up front so the first attachment send can't race
    // multer's destination callback on a cold deploy.
    ensureUploadDirs();
  }
}
