import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { WhatsAppAccount } from '@prisma/client';
import {
  CODE_TIMEOUT_MS,
  NO_SUPPORT_NUMBER,
  WhatsAppProvisioningService,
} from './whatsapp-provisioning.service';
import { WhatsAppGraphError } from './whatsapp-graph.service';
import type { WhatsAppGraphService } from './whatsapp-graph.service';
import type { WhatsAppAccountService } from './whatsapp-account.service';
import type { PhoneEventsService } from '../phone/phone-events.service';
import type { SignalWireService } from '../phone/signalwire.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * "Generate WhatsApp account" — the four Meta steps, and the code read back off the
 * support number. Neither Meta nor SignalWire is reachable from a dev machine, so these
 * are the proof that a text completes a pending number exactly once.
 */
const KEY = 'ab'.repeat(32);
const SUPPORT = '+15145551234';

function row(over: Partial<WhatsAppAccount> = {}): WhatsAppAccount {
  return {
    id: 1,
    companyId: 7,
    wabaId: 'WABA',
    phoneNumberId: 'PN1',
    displayPhoneNumber: '+1 514-555-1234',
    verifiedName: 'Acme Inc',
    accessToken: null,
    registrationPin: null,
    origin: 'GENERATED',
    setupStatus: 'PENDING_CODE',
    setupError: null,
    codeRequestedAt: new Date(),
    connectedById: 3,
    connectedAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

type Opts = {
  support?: { phoneNumber: string; companyId: number } | null;
  account?: WhatsAppAccount | null;
  pending?: WhatsAppAccount[];
  claim?: number;
};

function make(opts: Opts = {}) {
  const account = opts.account ?? null;
  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue({
        id: 7,
        businessName: 'Acme Inc',
        isInternal: false,
      }),
      findUnique: jest.fn().mockResolvedValue({ businessName: 'Acme Inc' }),
    },
    supportNumber: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.support === undefined
            ? { phoneNumber: SUPPORT, companyId: 7 }
            : opts.support,
        ),
    },
    whatsAppAccount: {
      findUnique: jest.fn().mockResolvedValue(account),
      findMany: jest.fn().mockResolvedValue(opts.pending ?? []),
      upsert: jest.fn(({ create }: { create: Partial<WhatsAppAccount> }) =>
        Promise.resolve(row(create)),
      ),
      update: jest.fn(({ data }: { data: Partial<WhatsAppAccount> }) =>
        Promise.resolve(row({ ...(account ?? {}), ...data })),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claim ?? 1 }),
    },
  };
  const graph = {
    findWabaPhoneNumber: jest.fn().mockResolvedValue(null),
    addPhoneNumber: jest.fn().mockResolvedValue('PN1'),
    getPhoneNumber: jest.fn().mockResolvedValue({
      id: 'PN1',
      displayPhoneNumber: '+1 514-555-1234',
      verifiedName: 'Acme Inc',
      status: 'PENDING',
      codeVerificationStatus: 'NOT_VERIFIED',
    }),
    requestCode: jest.fn().mockResolvedValue(undefined),
    verifyCode: jest.fn().mockResolvedValue(undefined),
    registerNumber: jest.fn().mockResolvedValue(undefined),
    subscribeApp: jest.fn().mockResolvedValue(undefined),
  };
  const accounts = {
    assertNumberFree: jest.fn().mockResolvedValue(undefined),
    encryptionKey: () => KEY,
  };
  const events = { smsReceived$: new Subject() };
  const signalwire = { listMessages: jest.fn().mockResolvedValue([]) };

  const svc = new WhatsAppProvisioningService(
    prisma as unknown as PrismaService,
    graph as unknown as WhatsAppGraphService,
    accounts as unknown as WhatsAppAccountService,
    events as unknown as PhoneEventsService,
    signalwire as unknown as SignalWireService,
  );
  (svc as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger = {
    log: jest.fn(),
    warn: jest.fn(),
  };
  return { svc, prisma, graph, accounts, signalwire };
}

describe('WhatsAppProvisioningService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.WHATSAPP_TOKEN = 'firm-token';
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'WABA';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  describe('generate', () => {
    it('answers NO_SUPPORT_NUMBER when the company has no number — the client opens the buy popup', async () => {
      const { svc, graph } = make({ support: null });
      const err = await svc.generate(7, 3).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: NO_SUPPORT_NUMBER,
      });
      expect(graph.addPhoneNumber).not.toHaveBeenCalled();
    });

    it('refuses before touching Meta when the firm token is missing', async () => {
      delete process.env.WHATSAPP_TOKEN;
      const { svc, graph } = make();
      await expect(svc.generate(7, 3)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(graph.findWabaPhoneNumber).not.toHaveBeenCalled();
    });

    it('adds the support number under the company name, asks for the code and waits', async () => {
      const { svc, graph, prisma } = make();
      const view = await svc.generate(7, 3);

      expect(graph.addPhoneNumber).toHaveBeenCalledWith(
        'WABA',
        '1',
        '5145551234',
        'Acme Inc',
        'firm-token',
      );
      expect(graph.requestCode).toHaveBeenCalledWith('PN1', 'firm-token');
      expect(graph.verifyCode).not.toHaveBeenCalled();
      expect(prisma.whatsAppAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            companyId: 7,
            origin: 'GENERATED',
            setupStatus: 'PENDING_CODE',
            accessToken: null,
          }) as unknown,
        }),
      );
      expect(view.setupStatus).toBe('PENDING_CODE');
    });

    it('reuses a number an earlier attempt already added, instead of adding it twice', async () => {
      const { svc, graph } = make();
      graph.findWabaPhoneNumber.mockResolvedValue({
        id: 'PN9',
        displayPhoneNumber: '+1 514-555-1234',
        verifiedName: 'Acme Inc',
        status: 'PENDING',
        codeVerificationStatus: 'NOT_VERIFIED',
      });
      await svc.generate(7, 3);
      expect(graph.findWabaPhoneNumber).toHaveBeenCalledWith(
        'WABA',
        '15145551234',
        'firm-token',
      );
      expect(graph.addPhoneNumber).not.toHaveBeenCalled();
      expect(graph.requestCode).toHaveBeenCalledWith('PN9', 'firm-token');
    });

    it('registers straight away when the number is already verified — no new code', async () => {
      const { svc, graph } = make();
      graph.findWabaPhoneNumber.mockResolvedValue({
        id: 'PN1',
        displayPhoneNumber: '+1 514-555-1234',
        verifiedName: 'Acme Inc',
        status: 'PENDING',
        codeVerificationStatus: 'VERIFIED',
      });
      const view = await svc.generate(7, 3);
      expect(graph.requestCode).not.toHaveBeenCalled();
      expect(graph.verifyCode).not.toHaveBeenCalled();
      expect(graph.registerNumber).toHaveBeenCalled();
      expect(view.setupStatus).toBe('CONNECTED');
    });

    it('refuses a company that already has a connected number', async () => {
      const { svc } = make({ account: row({ setupStatus: 'CONNECTED' }) });
      await expect(svc.generate(7, 3)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('reading the code from a text', () => {
    it('completes a pending number from the SMS webhook', async () => {
      const { svc, graph, prisma } = make({ account: row() });
      await svc.onSms({
        to: SUPPORT,
        from: '+15551234567',
        body: "Your WhatsApp Business code 123-456. Don't share this code",
      });
      expect(graph.verifyCode).toHaveBeenCalledWith(
        'PN1',
        '123456',
        'firm-token',
      );
      expect(graph.registerNumber).toHaveBeenCalledWith(
        'PN1',
        expect.stringMatching(/^\d{6}$/),
        'firm-token',
      );
      expect(prisma.whatsAppAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            setupStatus: 'CONNECTED',
          }) as unknown,
        }),
      );
    });

    it('ignores an ordinary text', async () => {
      const { svc, graph } = make({ account: row() });
      await svc.onSms({
        to: SUPPORT,
        from: '+1555',
        body: 'hello, call me back',
      });
      expect(graph.verifyCode).not.toHaveBeenCalled();
    });

    it('never verifies twice when the webhook and the sweep race', async () => {
      const { svc, graph } = make({ account: row(), claim: 0 });
      await svc.complete(row(), '123456');
      expect(graph.verifyCode).not.toHaveBeenCalled();
    });

    it('marks the number FAILED with a readable reason when Meta refuses', async () => {
      const { svc, graph, prisma } = make({ account: row() });
      graph.registerNumber.mockRejectedValue(
        new WhatsAppGraphError('too many', 400, 133016),
      );
      const view = await svc.complete(row(), '123456');
      expect(view.setupStatus).toBe('FAILED');
      expect(prisma.whatsAppAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            setupStatus: 'FAILED',
            setupError: expect.stringMatching(/72 hours/) as unknown,
          }) as unknown,
        }),
      );
    });

    it('the sweep finds a code the webhook missed', async () => {
      const pending = row();
      const { svc, graph, signalwire } = make({
        account: pending,
        pending: [pending],
      });
      signalwire.listMessages.mockResolvedValue([
        { body: 'Your WhatsApp code 111-222' },
      ]);
      await svc.sweepPending();
      expect(signalwire.listMessages).toHaveBeenCalledWith(
        expect.objectContaining({ to: SUPPORT }),
      );
      expect(graph.verifyCode).toHaveBeenCalledWith(
        'PN1',
        '111222',
        'firm-token',
      );
    });

    it('the sweep gives up once the code is overdue', async () => {
      const stale = row({
        codeRequestedAt: new Date(Date.now() - CODE_TIMEOUT_MS - 60_000),
      });
      const { svc, prisma, graph } = make({ account: stale, pending: [stale] });
      await svc.sweepPending();
      expect(graph.verifyCode).not.toHaveBeenCalled();
      expect(prisma.whatsAppAccount.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1, setupStatus: 'PENDING_CODE' },
          data: expect.objectContaining({ setupStatus: 'FAILED' }) as unknown,
        }),
      );
    });
  });
});
