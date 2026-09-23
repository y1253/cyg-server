import type { File as MulterFile } from 'multer';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
import { PhoneEventsService } from './phone-events.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneDialerService } from './phone-dialer.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { SendSmsDto } from './dto/send-sms.dto.js';
import { StartCallDto } from './dto/start-call.dto.js';
import { PhoneItemStateDto } from './dto/phone-item-state.dto.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhoneAudioService } from '../phone-audio/phone-audio.service.js';
import { PhoneSettingsService } from '../phone-settings/phone-settings.service.js';
import { CallSummaryService } from './call-summary.service.js';
import { Observable } from 'rxjs';
import type { Request as ExpressRequest, Response } from 'express';
import { CallControlService } from './call-control.service';
import { TransferCallDto } from './dto/transfer-call.dto';
import { AddCallDto, PartyDto, PartyHoldDto } from './dto/conference.dto';
import { ConferenceService } from './conference.service';
import { QuickReplyDto } from './dto/quick-reply.dto.js';
import { ActiveCallsService } from './active-calls.service.js';
import { RingGroupService } from './ring-group.service.js';
interface MessageEvent {
    data: string;
}
export declare class PhoneController {
    private readonly provisioning;
    private readonly events;
    private readonly timeline;
    private readonly dialer;
    private readonly state;
    private readonly signalwire;
    private readonly prisma;
    private readonly audio;
    private readonly settings;
    private readonly summaries;
    private readonly callControl;
    private readonly conference;
    private readonly activeCalls;
    private readonly ringGroup;
    private readonly storage;
    private readonly realtime;
    constructor(provisioning: PhoneProvisioningService, events: PhoneEventsService, timeline: PhoneTimelineService, dialer: PhoneDialerService, state: MessageStateService, signalwire: SignalWireService, prisma: PrismaService, audio: PhoneAudioService, settings: PhoneSettingsService, summaries: CallSummaryService, callControl: CallControlService, conference: ConferenceService, activeCalls: ActiveCallsService, ringGroup: RingGroupService, storage: ObjectStorageService, realtime: RealtimeService);
    private readonly logger;
    getSipCredentials(): {
        domain: string;
        username: string;
        password: string;
        wsServer: string;
    };
    getPendingCall(req: {
        user: {
            userId: number;
        };
    }): import("./phone-events.service.js").CallEvent | null;
    getPendingCalls(req: {
        user: {
            userId: number;
        };
    }): import("./phone-events.service.js").CallEvent[];
    streamEvents(token: string, req: ExpressRequest): Observable<MessageEvent>;
    getRecording(sid: string, token: string, range: string, res: Response): Promise<void>;
    getSmsMedia(messageSid: string, mediaSid: string, token: string, download: string, range: string, res: Response): Promise<void>;
    getAudio(id: number, token: string, range: string, res: Response): Promise<void>;
    searchAvailable(country: string, areaCode?: string): Promise<import("./phone.types.js").AvailableNumberSearch>;
    presence(): Promise<{
        userIds: number[];
        busyUserIds: number[];
    }>;
    heartbeat(body: {
        busy?: boolean;
    }, req: {
        user: {
            userId: number;
        };
    }): {
        ok: true;
    };
    getNumber(companyId: number): Promise<{
        region: string | null;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        activeForCompanyId: number | null;
        sid: string;
        phoneNumber: string;
        releasedAt: Date | null;
    } | null>;
    attachNumber(companyId: number, dto: AttachNumberDto): Promise<{
        region: string | null;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        activeForCompanyId: number | null;
        sid: string;
        phoneNumber: string;
        releasedAt: Date | null;
    }>;
    releaseNumber(companyId: number): Promise<void>;
    getTimeline(companyId: number, before?: string, limit?: string): Promise<import("./phone.types.js").PhoneTimelineResult>;
    hold(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        recordingPaused: boolean;
    }>;
    resume(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        recordingPaused: boolean;
    }>;
    declineWithText(companyId: number, sid: string, dto: QuickReplyDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        voicemail: boolean;
        texted: boolean;
    }>;
    decline(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        voicemail: boolean;
    }>;
    hangUp(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        ended: string[];
    }>;
    transferBlind(companyId: number, sid: string, dto: TransferCallDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        transferredSid: string;
        target: {
            id: number;
            name: string;
        };
    }>;
    transferStatus(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        state: import("./call-legs.util.js").TransferState;
        targetName: string | null;
    }>;
    private conferenceContext;
    conferenceAdd(companyId: number, sid: string, dto: AddCallDto, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./call-legs.util.js").ConferenceView>;
    conferenceHold(companyId: number, sid: string, dto: PartyHoldDto, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./call-legs.util.js").ConferenceView>;
    conferenceSwap(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./call-legs.util.js").ConferenceView>;
    conferenceMerge(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./call-legs.util.js").ConferenceView>;
    conferenceDrop(companyId: number, sid: string, dto: PartyDto, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./call-legs.util.js").ConferenceView>;
    conferenceStatus(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./call-legs.util.js").ConferenceView>;
    holdAudio(companyId: number): Promise<{
        audioId: number;
        name: string;
    } | {
        audioId: null;
        name?: undefined;
    }>;
    getRinging(companyId: number, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./phone-events.service.js").CallEvent | null>;
    getActiveCall(companyId: number, req: {
        user: {
            userId: number;
        };
    }): Promise<import("./active-calls.util.js").ActiveCallView | null>;
    callAnswered(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<void>;
    private companyForPhone;
    getCounts(companyId: number): Promise<import("./phone.types.js").PhoneCountsDto>;
    getSmsThread(companyId: number, peer: string): Promise<import("./phone.types.js").SmsThreadResult>;
    sendSms(companyId: number, dto: SendSmsDto, attachments: MulterFile[] | undefined): Promise<import("./phone.types.js").SmsItemDto>;
    startCall(companyId: number, dto: StartCallDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        callSid: string;
        to: string;
        companyName: string;
    }>;
    getCallRecordings(companyId: number, sid: string, parentCallSid?: string): Promise<{
        recordings: import("./phone.types.js").RecordingDto[];
        summary: import("./call-summary.util.js").CallSummaryView | null;
    }>;
    completeCall(companyId: number, sid: string, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        itemId: string;
    }>;
    markRead(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    markUnread(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    markComplete(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    markUncomplete(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    private setRecordingPaused;
    private freshenAfterCallEnded;
}
export {};
