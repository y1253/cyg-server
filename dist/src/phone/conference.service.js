"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ConferenceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConferenceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const signalwire_service_1 = require("./signalwire.service");
const phone_events_service_1 = require("./phone-events.service");
const call_control_service_1 = require("./call-control.service");
const call_legs_util_1 = require("./call-legs.util");
const conference_laml_util_1 = require("./conference-laml.util");
const signalwire_parse_1 = require("./signalwire-parse");
const phone_config_1 = require("./phone.config");
let ConferenceService = class ConferenceService {
    static { ConferenceService_1 = this; }
    prisma;
    signalwire;
    events;
    callControl;
    logger = new common_1.Logger(ConferenceService_1.name);
    static RING_TIMEOUT = 30;
    static TTL_MS = 4 * 60 * 60 * 1000;
    static ROOM_LOOKUP_ATTEMPTS = 20;
    static ROOM_LOOKUP_DELAY_MS = 400;
    static FORMING_GRACE_MS = 15_000;
    conferences = new Map();
    constructor(prisma, signalwire, events, callControl) {
        this.prisma = prisma;
        this.signalwire = signalwire;
        this.events = events;
        this.callControl = callControl;
    }
    joinTargetFor(callSid) {
        for (const record of this.conferences.values()) {
            if (record.state === 'ended')
                continue;
            if (record.rootSid === callSid ||
                record.agentSid === callSid ||
                record.parties.some((p) => p.legSid === callSid)) {
                return record;
            }
        }
        return null;
    }
    recordForLeg(callSid) {
        return this.joinTargetFor(callSid);
    }
    recordForRoom(room) {
        const rootSid = (0, call_legs_util_1.rootSidFromRoom)(room);
        if (!rootSid)
            return null;
        const record = this.conferences.get(rootSid);
        return record && record.state !== 'ended' ? record : null;
    }
    noteConferenceEvent(body) {
        try {
            const room = body.FriendlyName ?? '';
            const event = body.StatusCallbackEvent ?? '';
            const conferenceSid = body.ConferenceSid ?? '';
            const callSid = body.CallSid ?? '';
            const record = this.recordForRoom(room);
            if (!record)
                return;
            if (event === 'conference-end') {
                if (record.conferenceSid && conferenceSid !== record.conferenceSid) {
                    this.logger.warn(`${room} ignoring conference-end for foreign sid ${conferenceSid} ` +
                        `(ours is ${record.conferenceSid})`);
                    return;
                }
                record.state = 'ended';
                this.conferences.delete(record.rootSid);
                this.logger.log(`${room} ended (${conferenceSid})`);
                return;
            }
            if (conferenceSid) {
                if (!record.conferenceSid) {
                    record.conferenceSid = conferenceSid;
                }
                else if (record.conferenceSid !== conferenceSid) {
                    this.logger.error(`${room} SPLIT ROOM: leg ${callSid} joined ${conferenceSid} but ours is ` +
                        `${record.conferenceSid}`);
                }
            }
            if (event === 'participant-join' && callSid)
                record.joined.add(callSid);
            if (event === 'participant-leave' && callSid)
                record.joined.delete(callSid);
            if (record.state === 'forming' &&
                record.joined.has(record.agentSid) &&
                record.joined.has(record.rootSid)) {
                record.state = 'live';
                this.logger.log(`${room} forming -> live (${record.conferenceSid})`);
            }
        }
        catch (err) {
            this.logger.warn(`noteConferenceEvent failed: ${String(err)}`);
        }
    }
    async addCall(ctx, target) {
        const existing = this.conferences.get(ctx.rootSid);
        if (existing && existing.parties.length >= call_legs_util_1.MAX_ADDED_PARTIES + 1) {
            throw new common_1.BadRequestException(`You can add up to ${call_legs_util_1.MAX_ADDED_PARTIES} more people to a call`);
        }
        const resolved = await this.resolveAddTarget(ctx, target);
        const record = existing ?? (await this.beginConference(ctx));
        const peerLeg = record.parties.find((p) => p.kind === 'peer')?.legSid;
        const { sid: conferenceSid, participants } = await this.awaitRoom(record, peerLeg ? [record.agentSid, peerLeg] : [record.agentSid]);
        record.conferenceSid = conferenceSid;
        if (record.state === 'forming') {
            record.state = 'live';
            this.logger.log(`${record.room} forming -> live (${conferenceSid})`);
        }
        await this.holdAll(conferenceSid, record, true, participants);
        const call = await this.signalwire.createCall({
            to: resolved.to,
            from: resolved.from,
            laml: (0, conference_laml_util_1.conferenceDoc)({
                room: record.room,
                role: 'party',
                isRoot: false,
                holdUrl: (0, phone_config_1.webhookUrls)(process.env).conferenceWaitUrl,
            }),
            statusCallback: (0, phone_config_1.webhookUrls)(process.env).statusCallback,
            timeoutSec: ConferenceService_1.RING_TIMEOUT,
        });
        record.parties.push({
            id: `p${record.nextPartyId}`,
            legSid: call.sid,
            label: resolved.label,
            kind: resolved.kind,
        });
        record.nextPartyId += 1;
        this.logger.log(`addCall root=${ctx.rootSid} +${resolved.label} (${record.parties.length} parties)`);
        if (resolved.notifyUserId !== undefined) {
            this.events.broadcastIncomingCall([resolved.notifyUserId], {
                type: 'incoming-call',
                direction: 'inbound',
                companyId: ctx.companyId,
                companyName: ctx.companyName,
                from: ctx.companyName,
                callSid: call.sid,
                at: Date.now(),
                kind: ctx.kind === 'internal' ? 'internal' : 'company',
                transferFrom: ctx.requester,
            }, { publishToCompany: false });
        }
        return this.viewOf(record, conferenceSid);
    }
    async setPartyHold(ctx, partyId, held) {
        const record = this.requireRecord(ctx.rootSid);
        const conferenceSid = await this.requireRoomSid(record);
        const party = this.requireParty(record, partyId);
        await this.setHold(conferenceSid, party, held);
        return this.viewOf(record, conferenceSid);
    }
    async swap(ctx) {
        const record = this.requireRecord(ctx.rootSid);
        const conferenceSid = await this.requireRoomSid(record);
        const participants = await this.signalwire.listParticipants(conferenceSid);
        const heldByLeg = new Map(participants.map((p) => [p.callSid, p.hold]));
        const present = record.parties.filter((p) => heldByLeg.has(p.legSid));
        if (present.length !== 2) {
            throw new common_1.BadRequestException('Swapping needs exactly two other people on the call');
        }
        const [a, b] = present;
        const toHold = heldByLeg.get(a.legSid) === false ? a : b;
        const toResume = toHold === a ? b : a;
        await this.setHold(conferenceSid, toHold, true);
        await this.setHold(conferenceSid, toResume, false);
        return this.viewOf(record, conferenceSid);
    }
    async merge(ctx) {
        const record = this.requireRecord(ctx.rootSid);
        const conferenceSid = await this.requireRoomSid(record);
        await this.holdAll(conferenceSid, record, false);
        return this.viewOf(record, conferenceSid);
    }
    async dropParty(ctx, partyId) {
        const record = this.requireRecord(ctx.rootSid);
        const conferenceSid = await this.requireRoomSid(record);
        const party = this.requireParty(record, partyId);
        const removed = await this.signalwire.removeParticipant(conferenceSid, party.legSid);
        if (!removed) {
            await this.signalwire
                .updateCall(party.legSid, { status: 'completed' })
                .catch((err) => this.logger.warn(`dropParty fallback failed: ${String(err)}`));
        }
        record.parties = record.parties.filter((p) => p.id !== partyId);
        if (record.parties.length === 1) {
            const last = record.parties[0];
            const participants = await this.signalwire.listParticipants(conferenceSid);
            if (participants.find((p) => p.callSid === last.legSid)?.hold) {
                await this.setHold(conferenceSid, last, false);
            }
        }
        return this.viewOf(record, conferenceSid);
    }
    async conferenceStatus(rootSid) {
        const record = this.conferences.get(rootSid);
        if (!record)
            return this.inactive();
        if (record.state === 'forming') {
            return {
                active: true,
                parties: record.parties.map((p) => ({
                    id: p.id,
                    label: p.label,
                    state: 'ringing',
                })),
                merged: true,
                canAdd: false,
                canSwap: false,
            };
        }
        try {
            const conferenceSid = await this.pickRoom(record.room);
            if (!conferenceSid) {
                this.forget(record, 'room gone');
                return this.inactive();
            }
            const view = await this.viewOf(record, conferenceSid);
            if (!view.active)
                this.forget(record, 'agent left the room');
            return view;
        }
        catch (err) {
            this.logger.warn(`${record.room} status check failed: ${String(err)}`);
            return this.inactive();
        }
    }
    forget(record, why) {
        if (Date.now() - record.at < ConferenceService_1.FORMING_GRACE_MS) {
            this.logger.debug(`${record.room} keeping record (${why}, still in grace)`);
            return;
        }
        record.state = 'ended';
        this.conferences.delete(record.rootSid);
        this.logger.log(`${record.room} record dropped (${why})`);
    }
    async beginConference(ctx) {
        const legs = await this.callControl.legsFor(ctx);
        if (!legs.agentSid || !legs.peerSid) {
            throw new common_1.BadRequestException('This call has not connected yet, so there is nobody to add to');
        }
        const room = (0, call_legs_util_1.conferenceRoomFor)(ctx.rootSid);
        const agentIsRoot = legs.agentSid === ctx.rootSid;
        const childSid = agentIsRoot ? legs.peerSid : legs.agentSid;
        const holdUrl = (0, phone_config_1.webhookUrls)(process.env).conferenceWaitUrl;
        const peerParty = {
            id: 'peer',
            legSid: legs.peerSid,
            label: ctx.companyName,
            kind: 'peer',
        };
        const record = {
            room,
            kind: ctx.kind,
            agentSid: legs.agentSid,
            rootSid: ctx.rootSid,
            childSid,
            state: 'forming',
            conferenceSid: null,
            joined: new Set(),
            parties: [peerParty],
            companyId: ctx.companyId,
            nextPartyId: 2,
            at: Date.now(),
        };
        this.conferences.set(ctx.rootSid, record);
        this.sweep();
        this.logger.log(`${room} opening kind=${ctx.kind} root=${ctx.rootSid} agent=${legs.agentSid} ` +
            `child=${childSid} — redirecting CHILD only, root joins via dial-status`);
        try {
            await this.signalwire.updateCall(childSid, {
                laml: (0, conference_laml_util_1.conferenceDoc)({
                    room,
                    role: childSid === legs.agentSid ? 'agent' : 'party',
                    isRoot: childSid === ctx.rootSid,
                    holdUrl,
                    statusCallback: (0, phone_config_1.webhookUrls)(process.env).conferenceStatusUrl,
                }),
            });
        }
        catch (err) {
            this.logger.error(`${room} child redirect failed: ${String(err)}`);
            throw err;
        }
        this.logger.log(`${room} child ${childSid} redirected`);
        return record;
    }
    async resolveAddTarget(ctx, target) {
        if ('userId' in target) {
            const sip = (0, phone_config_1.sipDialTarget)(process.env);
            if (!sip) {
                throw new common_1.BadRequestException('No SIP endpoint is configured, so a colleague cannot be added');
            }
            const user = await this.callControl.resolveTarget(target.userId, ctx.requester.id);
            return {
                to: `sip:${sip}`,
                from: `sip:${sip}`,
                label: user.name,
                kind: 'user',
                notifyUserId: user.id,
            };
        }
        const supportNumber = await this.supportNumberFor(ctx.companyId);
        const phone = 'phone' in target
            ? target.phone
            : await this.contactNumber(ctx.companyId, target.contactId);
        const label = 'phone' in target
            ? phone
            : await this.contactLabel(ctx.companyId, target.contactId);
        if (!(0, signalwire_parse_1.isE164)(phone)) {
            throw new common_1.BadRequestException('That is not a valid phone number');
        }
        if (phone === supportNumber) {
            throw new common_1.BadRequestException('Cannot add the company’s own number');
        }
        return { to: phone, from: supportNumber, label, kind: 'number' };
    }
    async supportNumberFor(companyId) {
        const row = await this.prisma.supportNumber.findFirst({
            where: { companyId, releasedAt: null },
            orderBy: { id: 'desc' },
            select: { phoneNumber: true },
        });
        if (!row)
            throw new common_1.NotFoundException('This company has no support number');
        return row.phoneNumber;
    }
    async contactRow(companyId, contactId) {
        const contact = await this.prisma.contact.findFirst({
            where: { id: contactId, companyId, deletedAt: null },
            select: { name: true, phoneE164: true },
        });
        if (!contact)
            throw new common_1.NotFoundException('Contact not found');
        if (!contact.phoneE164) {
            throw new common_1.BadRequestException(`${contact.name} has no number we can dial`);
        }
        return contact;
    }
    async contactNumber(companyId, contactId) {
        return (await this.contactRow(companyId, contactId)).phoneE164;
    }
    async contactLabel(companyId, contactId) {
        return (await this.contactRow(companyId, contactId)).name;
    }
    async setHold(conferenceSid, party, held) {
        await this.signalwire.updateParticipant(conferenceSid, party.legSid, {
            hold: held,
            ...(held && {
                holdUrl: (0, phone_config_1.webhookUrls)(process.env).conferenceWaitUrl,
                holdMethod: 'POST',
            }),
        });
    }
    async holdAll(conferenceSid, record, held, present) {
        const inRoom = present ? new Set(present.map((p) => p.callSid)) : null;
        for (const party of record.parties) {
            if (inRoom && !inRoom.has(party.legSid))
                continue;
            await this.setHold(conferenceSid, party, held);
        }
    }
    async pickRoom(room) {
        const rows = await this.signalwire.listConferences({ friendlyName: room });
        const usable = rows.filter((r) => r.status !== 'completed');
        if (usable.length > 1) {
            this.logger.error(`${room} SPLIT ROOM: ${usable.length} live rooms share this name — ` +
                usable.map((r) => `${r.sid}:${r.status}`).join(', '));
        }
        return (usable.find((r) => r.status === 'in-progress')?.sid ??
            usable[0]?.sid ??
            null);
    }
    async requireRoomSid(record) {
        const sid = record.conferenceSid ?? (await this.pickRoom(record.room));
        if (!sid) {
            throw new common_1.BadRequestException('That call is no longer in a conference');
        }
        record.conferenceSid = sid;
        return sid;
    }
    async awaitRoom(record, requiredLegs) {
        const started = Date.now();
        let lastSid = null;
        let lastPresent = [];
        for (let i = 0; i < ConferenceService_1.ROOM_LOOKUP_ATTEMPTS; i += 1) {
            const sid = await this.pickRoom(record.room);
            lastSid = sid;
            if (sid) {
                const participants = await this.signalwire.listParticipants(sid);
                const present = new Set(participants.map((p) => p.callSid));
                lastPresent = [...present];
                if (requiredLegs.every((leg) => present.has(leg))) {
                    this.logger.log(`${record.room} resolved sid=${sid} after ${i + 1} attempt(s) ` +
                        `(${Date.now() - started}ms) participants=[${lastPresent.join(', ')}]`);
                    return { sid, participants };
                }
            }
            this.logger.debug(`${record.room} attempt ${i + 1}/${ConferenceService_1.ROOM_LOOKUP_ATTEMPTS} ` +
                `sid=${sid ?? 'none'} present=[${lastPresent.join(', ')}] ` +
                `waiting for=[${requiredLegs.join(', ')}]`);
            if (i < ConferenceService_1.ROOM_LOOKUP_ATTEMPTS - 1) {
                await new Promise((r) => setTimeout(r, ConferenceService_1.ROOM_LOOKUP_DELAY_MS));
            }
        }
        this.logger.error(`${record.room} never assembled after ${Date.now() - started}ms — ` +
            `sid=${lastSid ?? 'none'} present=[${lastPresent.join(', ')}] ` +
            `expected=[${requiredLegs.join(', ')}]`);
        throw new common_1.BadRequestException('Still connecting everyone to the call — try again in a moment');
    }
    async viewOf(record, conferenceSid) {
        const participants = await this.signalwire.listParticipants(conferenceSid);
        const missing = record.parties.filter((p) => !participants.some((row) => row.callSid === p.legSid));
        const live = new Set();
        for (const party of missing) {
            const call = await this.signalwire.getCall(party.legSid).catch(() => null);
            if (call && (call.status === 'queued' || call.status === 'ringing')) {
                live.add(party.legSid);
            }
        }
        return (0, call_legs_util_1.conferenceStateOf)(participants, record, live);
    }
    inactive() {
        return {
            active: false,
            parties: [],
            merged: true,
            canAdd: false,
            canSwap: false,
        };
    }
    requireRecord(rootSid) {
        const record = this.conferences.get(rootSid);
        if (!record) {
            throw new common_1.NotFoundException('That call is not in a conference');
        }
        return record;
    }
    requireParty(record, partyId) {
        const party = record.parties.find((p) => p.id === partyId);
        if (!party)
            throw new common_1.NotFoundException('That person is not on this call');
        return party;
    }
    sweep() {
        const cutoff = Date.now() - ConferenceService_1.TTL_MS;
        for (const [sid, record] of this.conferences) {
            if (record.at < cutoff)
                this.conferences.delete(sid);
        }
    }
};
exports.ConferenceService = ConferenceService;
exports.ConferenceService = ConferenceService = ConferenceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        signalwire_service_1.SignalWireService,
        phone_events_service_1.PhoneEventsService,
        call_control_service_1.CallControlService])
], ConferenceService);
//# sourceMappingURL=conference.service.js.map