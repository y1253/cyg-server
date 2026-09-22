import { Injectable, Logger } from '@nestjs/common';
import { openAsBlob } from 'fs';
import {
  graphErrorOf,
  toTemplate,
  whatsappAcceptsCaption,
  whatsappConfig,
  type RawTemplate,
  type WhatsAppMediaKind,
} from './whatsapp.util.js';
import type { WhatsAppTemplateDto } from './whatsapp.types.js';

/**
 * How Meta should deliver the verification code.
 *
 * Stored on `WhatsAppAccount.codeMethod` while a number is PENDING_CODE, because it
 * decides two things later: whether the inbound-call webhook should intercept Meta's call
 * and record it, and whether the pending sweep should scan texts for a code that will
 * never arrive.
 */
export type CodeMethod = 'SMS' | 'VOICE';

/**
 * Per-call budgets, following `signalwire.service.ts`. An audio upload is the long one;
 * nothing here spends money, so a timeout costs a retry and nothing else.
 */
const TIMEOUTS = {
  exchangeCode: 10_000,
  read: 10_000,
  subscribe: 15_000,
  register: 20_000,
  send: 15_000,
  uploadMedia: 60_000,
  downloadMedia: 60_000,
} as const;

const PHONE_NUMBER_FIELDS =
  'id,display_phone_number,verified_name,status,code_verification_status';

interface RawPhoneNumber {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  code_verification_status?: string;
}

function toPhoneNumber(
  data: RawPhoneNumber | null,
  id: string,
): WabaPhoneNumber {
  return {
    id: data?.id ?? id,
    displayPhoneNumber: data?.display_phone_number ?? id,
    verifiedName: data?.verified_name ?? null,
    status: data?.status ?? null,
    codeVerificationStatus: data?.code_verification_status ?? null,
  };
}

/** Meta's largest media type is a 100 MB document. Anything bigger is not theirs. */
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export class WhatsAppGraphError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: number | null = null,
    readonly subcode: number | null = null,
  ) {
    super(message);
    this.name = 'WhatsAppGraphError';
  }
}

/** One number on a WABA, as the generate flow needs to see it. */
export interface WabaPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  /** `VERIFIED` once the SMS code was accepted, `NOT_VERIFIED` before. */
  codeVerificationStatus: string | null;
  /** `CONNECTED` once registered. */
  status: string | null;
}

interface CallInit {
  method: 'GET' | 'POST' | 'DELETE';
  token?: string;
  query?: Record<string, string | undefined>;
  json?: unknown;
  form?: FormData;
  timeoutMs: number;
}

/**
 * The ONLY code that talks to graph.facebook.com.
 *
 * Graph reports failure as an `error` object, usually with a non-2xx status — both are
 * checked, as Luxand taught this codebase not to trust `res.ok` alone. Every call logs
 * `label status ms`; nothing logs a token or the URL (the code exchange carries the app
 * secret in its query string).
 */
@Injectable()
export class WhatsAppGraphService {
  private readonly logger = new Logger(WhatsAppGraphService.name);

  private get base(): string {
    return `https://graph.facebook.com/${whatsappConfig(process.env).graphVersion}`;
  }

  private async call<T>(
    label: string,
    path: string,
    init: CallInit,
  ): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {};
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';

    const started = Date.now();
    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      this.logger.warn(`${label} ${name} after ${Date.now() - started}ms`);
      throw new WhatsAppGraphError(
        name === 'TimeoutError'
          ? 'WhatsApp did not respond in time'
          : 'WhatsApp could not be reached',
        0,
      );
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    this.logger.log(`${label} ${res.status} ${Date.now() - started}ms`);

    const error = graphErrorOf(data);
    if (!res.ok || error) {
      this.logger.warn(
        `${label} failed: ${error?.message ?? res.statusText} code=${error?.code ?? '-'} subcode=${error?.subcode ?? '-'}`,
      );
      throw new WhatsAppGraphError(
        error?.message ?? `WhatsApp request failed (${res.status})`,
        res.status,
        error?.code ?? null,
        error?.subcode ?? null,
      );
    }
    return data as T;
  }

  /**
   * Embedded Signup's code -> the customer's business integration token.
   *
   * The code lives for 30 SECONDS, which is why callers run this before anything else.
   * No redirect_uri: the JS SDK flow does not use one.
   */
  async exchangeCode(code: string): Promise<string> {
    const cfg = whatsappConfig(process.env);
    if (!cfg.appId || !cfg.appSecret) {
      throw new WhatsAppGraphError(
        'WhatsApp is not configured on the server (WHATSAPP_ID / WHATSAPP_SECRET)',
        0,
      );
    }
    const data = await this.call<{ access_token?: string }>(
      'exchangeCode',
      '/oauth/access_token',
      {
        method: 'GET',
        query: { client_id: cfg.appId, client_secret: cfg.appSecret, code },
        timeoutMs: TIMEOUTS.exchangeCode,
      },
    );
    if (!data?.access_token) {
      throw new WhatsAppGraphError('Meta returned no access token', 200);
    }
    return data.access_token;
  }

  async getPhoneNumber(
    phoneNumberId: string,
    token: string,
  ): Promise<WabaPhoneNumber> {
    const data = await this.call<RawPhoneNumber>(
      `getPhoneNumber ${phoneNumberId}`,
      `/${phoneNumberId}`,
      {
        method: 'GET',
        token,
        query: { fields: PHONE_NUMBER_FIELDS },
        timeoutMs: TIMEOUTS.read,
      },
    );
    return toPhoneNumber(data, phoneNumberId);
  }

  /**
   * Add a number to a WABA — the first of Meta's four steps for a number that does not
   * go through Embedded Signup. Returns the new phone_number_id.
   */
  async addPhoneNumber(
    wabaId: string,
    cc: string,
    phoneNumber: string,
    verifiedName: string,
    token: string,
  ): Promise<string> {
    const data = await this.call<{ id?: string }>(
      `addPhoneNumber ${wabaId}`,
      `/${wabaId}/phone_numbers`,
      {
        method: 'POST',
        token,
        json: { cc, phone_number: phoneNumber, verified_name: verifiedName },
        timeoutMs: TIMEOUTS.register,
      },
    );
    if (!data?.id) {
      throw new WhatsAppGraphError(
        'WhatsApp added the number but returned no id',
        200,
      );
    }
    return data.id;
  }

  /**
   * A number already on the WABA, matched on its digits (country code included), or null.
   * How a retry recovers after `addPhoneNumber` answered "already exists" (2388012).
   */
  async findWabaPhoneNumber(
    wabaId: string,
    digits: string,
    token: string,
  ): Promise<WabaPhoneNumber | null> {
    const data = await this.call<{ data?: RawPhoneNumber[] }>(
      `findPhoneNumber ${wabaId}`,
      `/${wabaId}/phone_numbers`,
      {
        method: 'GET',
        token,
        query: { fields: PHONE_NUMBER_FIELDS, limit: '100' },
        timeoutMs: TIMEOUTS.read,
      },
    );
    const hit = (data?.data ?? []).find(
      (row) => (row.display_phone_number ?? '').replace(/\D/g, '') === digits,
    );
    return hit?.id ? toPhoneNumber(hit, hit.id) : null;
  }

  /** Meta texts the verification code to the number. */
  /**
   * Ask Meta to send the six-digit verification code.
   *
   * `codeMethod` is SMS or VOICE. VOICE makes Meta CALL the number and read the code
   * aloud, which is the documented alternative when a text cannot be delivered — its own
   * failure message for an undeliverable text says "try an alternate verification method".
   * The label carries the method so the two attempts are distinguishable in the log.
   */
  async requestCode(
    phoneNumberId: string,
    token: string,
    codeMethod: CodeMethod = 'SMS',
  ): Promise<void> {
    await this.call(
      `requestCode ${codeMethod} ${phoneNumberId}`,
      `/${phoneNumberId}/request_code`,
      {
        method: 'POST',
        token,
        query: { code_method: codeMethod, language: 'en_US' },
        timeoutMs: TIMEOUTS.register,
      },
    );
  }

  /** `code` is the six digits, no hyphen. */
  async verifyCode(
    phoneNumberId: string,
    code: string,
    token: string,
  ): Promise<void> {
    await this.call(
      `verifyCode ${phoneNumberId}`,
      `/${phoneNumberId}/verify_code`,
      {
        method: 'POST',
        token,
        query: { code },
        timeoutMs: TIMEOUTS.register,
      },
    );
  }

  /** Frees the WABA's number slot when a generated number is disconnected. */
  async deregisterNumber(phoneNumberId: string, token: string): Promise<void> {
    await this.call(
      `deregisterNumber ${phoneNumberId}`,
      `/${phoneNumberId}/deregister`,
      { method: 'POST', token, timeoutMs: TIMEOUTS.register },
    );
  }

  async listWabaPhoneNumberIds(
    wabaId: string,
    token: string,
  ): Promise<string[]> {
    const data = await this.call<{ data?: { id?: string }[] }>(
      `listPhoneNumbers ${wabaId}`,
      `/${wabaId}/phone_numbers`,
      {
        method: 'GET',
        token,
        query: { fields: 'id', limit: '100' },
        timeoutMs: TIMEOUTS.read,
      },
    );
    return (data?.data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');
  }

  /** Without this, Meta sends the WABA's webhooks to nobody. */
  async subscribeApp(wabaId: string, token: string): Promise<void> {
    await this.call(`subscribeApp ${wabaId}`, `/${wabaId}/subscribed_apps`, {
      method: 'POST',
      token,
      timeoutMs: TIMEOUTS.subscribe,
    });
  }

  async unsubscribeApp(wabaId: string, token: string): Promise<void> {
    await this.call(`unsubscribeApp ${wabaId}`, `/${wabaId}/subscribed_apps`, {
      method: 'DELETE',
      token,
      timeoutMs: TIMEOUTS.subscribe,
    });
  }

  async registerNumber(
    phoneNumberId: string,
    pin: string,
    token: string,
  ): Promise<void> {
    await this.call(
      `registerNumber ${phoneNumberId}`,
      `/${phoneNumberId}/register`,
      {
        method: 'POST',
        token,
        json: { messaging_product: 'whatsapp', pin },
        timeoutMs: TIMEOUTS.register,
      },
    );
  }

  /**
   * `replyToWamid` makes this a native WhatsApp reply — the customer sees the quoted
   * message above it in their own app, exactly as if a person had used Reply.
   *
   * `context` is a top-level sibling of `type`, and it is spread in so its absence sends a
   * plain message rather than a `context: null` Meta would reject.
   */
  async sendText(
    phoneNumberId: string,
    token: string,
    to: string,
    body: string,
    replyToWamid?: string | null,
  ): Promise<string> {
    return this.sendMessage(`sendText ${phoneNumberId}`, phoneNumberId, token, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
      ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
    });
  }

  /**
   * Every template on this WABA, in EVERY state.
   *
   * ⚠️ The APPROVED-only filter that used to be here was OURS, not Meta's — the endpoint
   * returns PENDING, REJECTED, PAUSED and DISABLED too. Keeping it meant a template
   * submitted from the app was invisible for the whole review, which is precisely the
   * window somebody needs to see. Callers decide what is sendable
   * (`isSendableTemplate`); this reports what exists.
   *
   * ⚠️ Needs `whatsapp_business_management` on the token — a strictly larger permission
   * than the `whatsapp_business_messaging` every send uses. The firm system-user token
   * has it; a token minted by Embedded Signup only does if the Login-for-Business
   * configuration granted it, which is why the caller treats a failure here as "no
   * templates" rather than an error.
   */
  async listTemplates(
    wabaId: string,
    token: string,
  ): Promise<WhatsAppTemplateDto[]> {
    const data = await this.call<{ data?: RawTemplate[] }>(
      `listTemplates ${wabaId}`,
      `/${wabaId}/message_templates`,
      {
        method: 'GET',
        token,
        query: {
          fields: 'id,name,language,status,category,components,rejected_reason',
          limit: '200',
        },
        timeoutMs: TIMEOUTS.send,
      },
    );
    return (data?.data ?? [])
      .map(toTemplate)
      .filter((t): t is WhatsAppTemplateDto => t !== null);
  }

  /**
   * Submit a new template for Meta's review.
   *
   * ⚠️ Read `status` off the RESPONSE and believe it. A simple UTILITY template is often
   * approved instantly, so a caller that assumes PENDING and waits for a webhook would
   * wait forever for a template that is already sendable.
   *
   * `components` comes from `buildTemplateComponents`, which owns the rule that a body
   * with `{{n}}` must carry an `example` — Meta rejects the submission outright without
   * one, and its wording does not say so.
   */
  async createTemplate(
    wabaId: string,
    token: string,
    input: {
      name: string;
      language: string;
      category: string;
      components: unknown[];
    },
  ): Promise<{ id: string | null; status: string }> {
    const data = await this.call<{ id?: string; status?: string }>(
      `createTemplate ${wabaId} ${input.name}`,
      `/${wabaId}/message_templates`,
      {
        method: 'POST',
        token,
        json: {
          name: input.name,
          language: input.language,
          category: input.category,
          components: input.components,
        },
        timeoutMs: TIMEOUTS.register,
      },
    );
    return { id: data?.id ?? null, status: data?.status ?? 'PENDING' };
  }

  /**
   * Edit a template and resubmit it — the ONLY sane response to a rejection.
   *
   * ⚠️ Do not "create it again with fixes": a name+language pair cannot be created while
   * one already exists in any state, deleting it removes EVERY language of that name, and
   * Meta then blocks re-creating that name for four weeks. Editing keeps the name.
   */
  async editTemplate(
    templateId: string,
    token: string,
    components: unknown[],
  ): Promise<void> {
    await this.call(`editTemplate ${templateId}`, `/${templateId}`, {
      method: 'POST',
      token,
      json: { components },
      timeoutMs: TIMEOUTS.register,
    });
  }

  /**
   * Send an approved template — the ONLY way to write to somebody outside the 24-hour
   * window, and therefore the only way to open a conversation at all.
   *
   * `components` is passed through as Meta shapes it (`[{ type: 'body', parameters: [
   * { type: 'text', text } ] }]`) rather than being built here, because header and button
   * components follow the same shape and a caller that needs one should not have to work
   * around a signature that only understands the body.
   */
  async sendTemplate(
    phoneNumberId: string,
    token: string,
    to: string,
    name: string,
    language: string,
    components: unknown[],
  ): Promise<string> {
    return this.sendMessage(
      `sendTemplate ${phoneNumberId}`,
      phoneNumberId,
      token,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      },
    );
  }

  /**
   * Send an already-uploaded file as whatever WhatsApp should render it as.
   *
   * One method for all five kinds, because Meta's payload is the same shape throughout —
   * `type: K` beside `K: { id }` — and the only differences are which extra fields that
   * inner object accepts. `caption` rides on image, video and document only; `filename` is
   * document-only and is what the recipient sees under the file icon. Both are dropped
   * rather than sent-and-ignored, so a caller cannot half-succeed.
   */
  async sendMedia(
    phoneNumberId: string,
    token: string,
    to: string,
    kind: WhatsAppMediaKind,
    mediaId: string,
    opts: {
      caption?: string | null;
      filename?: string | null;
      replyToWamid?: string | null;
    } = {},
  ): Promise<string> {
    const media: Record<string, unknown> = { id: mediaId };
    if (opts.caption && whatsappAcceptsCaption(kind)) {
      media.caption = opts.caption;
    }
    if (opts.filename && kind === 'document') media.filename = opts.filename;

    return this.sendMessage(
      `sendMedia ${kind} ${phoneNumberId}`,
      phoneNumberId,
      token,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: kind,
        [kind]: media,
        ...(opts.replyToWamid
          ? { context: { message_id: opts.replyToWamid } }
          : {}),
      },
    );
  }

  private async sendMessage(
    label: string,
    phoneNumberId: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const data = await this.call<{ messages?: { id?: string }[] }>(
      label,
      `/${phoneNumberId}/messages`,
      { method: 'POST', token, json: payload, timeoutMs: TIMEOUTS.send },
    );
    const wamid = data?.messages?.[0]?.id;
    if (!wamid) {
      throw new WhatsAppGraphError(
        'WhatsApp accepted the message but returned no id',
        200,
      );
    }
    return wamid;
  }

  async uploadMedia(
    phoneNumberId: string,
    token: string,
    bytes: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    // A standalone ArrayBuffer copy: a Buffer can be a view into Node's shared pool, and
    // handing Blob the pooled buffer would upload other allocations' bytes with it.
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    form.append('file', new Blob([copy], { type: mimeType }), filename);

    const data = await this.call<{ id?: string }>(
      `uploadMedia ${phoneNumberId}`,
      `/${phoneNumberId}/media`,
      { method: 'POST', token, form, timeoutMs: TIMEOUTS.uploadMedia },
    );
    if (!data?.id) {
      throw new WhatsAppGraphError(
        'WhatsApp stored the file but returned no id',
        200,
      );
    }
    return data.id;
  }

  /**
   * Upload a file STRAIGHT OFF DISK, without reading it into a Buffer first.
   *
   * The Buffer form above is right for bytes we just produced in memory (a transcoded
   * voice note). It is not right for an attachment: a document may be 100 MB, and the
   * Buffer path costs that twice over — multer's copy plus the deliberate standalone
   * `ArrayBuffer` slice — per concurrent send. `openAsBlob` hands undici a Blob backed by
   * the file, so the bytes stream from disk and peak memory stops tracking file size.
   *
   * This is the same argument `outbound-uploads.ts` makes for staging large email
   * attachments on disk rather than in RAM.
   */
  async uploadMediaFromFile(
    phoneNumberId: string,
    token: string,
    absolutePath: string,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append(
      'file',
      await openAsBlob(absolutePath, { type: mimeType }),
      filename,
    );

    const data = await this.call<{ id?: string }>(
      `uploadMediaFromFile ${phoneNumberId}`,
      `/${phoneNumberId}/media`,
      { method: 'POST', token, form, timeoutMs: TIMEOUTS.uploadMedia },
    );
    if (!data?.id) {
      throw new WhatsAppGraphError(
        'WhatsApp stored the file but returned no id',
        200,
      );
    }
    return data.id;
  }

  /**
   * Download a received file. Two requests: the media id resolves to a short-lived
   * (~5 min) lookaside URL, and THAT URL also needs the bearer token.
   */
  async downloadMedia(
    mediaId: string,
    token: string,
  ): Promise<{ bytes: Buffer; mimeType: string | null }> {
    const info = await this.call<{
      url?: string;
      mime_type?: string;
      file_size?: number;
    }>(`getMedia ${mediaId}`, `/${mediaId}`, {
      method: 'GET',
      token,
      timeoutMs: TIMEOUTS.read,
    });
    if (!info?.url)
      throw new WhatsAppGraphError('WhatsApp returned no media URL', 200);
    if (
      typeof info.file_size === 'number' &&
      info.file_size > MAX_MEDIA_BYTES
    ) {
      throw new WhatsAppGraphError('WhatsApp media is too large to store', 413);
    }

    const started = Date.now();
    const res = await fetch(info.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUTS.downloadMedia),
    });
    this.logger.log(
      `downloadMedia ${mediaId} ${res.status} ${Date.now() - started}ms`,
    );
    if (!res.ok) {
      throw new WhatsAppGraphError(
        `WhatsApp media download failed (${res.status})`,
        res.status,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_MEDIA_BYTES) {
      throw new WhatsAppGraphError('WhatsApp media is too large to store', 413);
    }
    return {
      bytes,
      mimeType: info.mime_type ?? res.headers.get('content-type'),
    };
  }
}
