import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
import { PhoneEventsService } from './phone-events.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneDialerService } from './phone-dialer.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { SendSmsDto } from './dto/send-sms.dto.js';
import { StartCallDto } from './dto/start-call.dto.js';
import { PhoneItemStateDto } from './dto/phone-item-state.dto.js';
import { Observable } from 'rxjs';
import type { Request as ExpressRequest, Response } from 'express';
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
    constructor(provisioning: PhoneProvisioningService, events: PhoneEventsService, timeline: PhoneTimelineService, dialer: PhoneDialerService, state: MessageStateService, signalwire: SignalWireService);
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
    streamEvents(token: string, req: ExpressRequest): Observable<MessageEvent>;
    getRecording(sid: string, token: string, range: string, res: Response): Promise<void>;
    searchAvailable(country: string, areaCode?: string): Promise<import("./signalwire-parse.js").AvailableNumber[]>;
    getNumber(companyId: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        region: string | null;
        sid: string;
        phoneNumber: string;
        activeForCompanyId: number | null;
        releasedAt: Date | null;
    } | null>;
    attachNumber(companyId: number, dto: AttachNumberDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        region: string | null;
        sid: string;
        phoneNumber: string;
        activeForCompanyId: number | null;
        releasedAt: Date | null;
    }>;
    releaseNumber(companyId: number): Promise<void>;
    getTimeline(companyId: number, before?: string, limit?: string): Promise<import("./phone.types.js").PhoneTimelineResult>;
    getCounts(companyId: number): Promise<{
        unread: number;
        uncompleted: number;
    }>;
    getSmsThread(companyId: number, peer: string): Promise<import("./phone.types.js").SmsThreadResult>;
    sendSms(companyId: number, dto: SendSmsDto): Promise<import("./phone.types.js").SmsItemDto>;
    startCall(companyId: number, dto: StartCallDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        callSid: string;
        to: string;
        companyName: string;
    }>;
    getCallRecordings(companyId: number, sid: string): Promise<import("./phone.types.js").RecordingDto[]>;
    markRead(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    markUnread(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    markComplete(companyId: number, dto: PhoneItemStateDto): Promise<void>;
    markUncomplete(companyId: number, dto: PhoneItemStateDto): Promise<void>;
}
export {};
