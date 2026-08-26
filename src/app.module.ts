import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { TodosModule } from './todos/todos.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TaskSchedulesModule } from './task-schedules/task-schedules.module.js';
import { LinksModule } from './links/links.module.js';
import { NotesModule } from './notes/notes.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { LuxandModule } from './luxand/luxand.module.js';
import { GmailModule } from './gmail/gmail.module.js';
import { MicrosoftModule } from './microsoft/microsoft.module.js';
import { CommunicationsModule } from './communications/communications.module.js';
import { InternalMessagesModule } from './internal-messages/internal-messages.module.js';
import { AiModule } from './ai/ai.module.js';
import { PhoneModule } from './phone/phone.module.js';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    LuxandModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    TodosModule,
    TasksModule,
    TaskSchedulesModule,
    LinksModule,
    NotesModule,
    SchedulerModule,
    GmailModule,
    MicrosoftModule,
    CommunicationsModule,
    InternalMessagesModule,
    AiModule,
    PhoneModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
