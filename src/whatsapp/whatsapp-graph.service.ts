import { Injectable, Logger } from '@nestjs/common';
import { graphErrorOf, whatsappConfig } from './whatsapp.util.js';

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
  ): Promise<{
    id: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    status: string | null;
  }> {
    const data = await this.call<{
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      status?: string;
    }>(`getPhoneNumber ${phoneNumberId}`, `/${phoneNumberId}`, {
      method: 'GET',
      token,
      query: { fields: 'id,display_phone_number,verified_name,status' },
      timeoutMs: TIMEOUTS.read,
    });
    return {
      id: data?.id ?? phoneNumberId,
      displayPhoneNumber: data?.display_phone_number ?? phoneNumberId,
      verifiedName: data?.verified_name ?? null,
      status: data?.status ?? null,
    };
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

  async sendText(
    phoneNumberId: string,
    token: string,
    to: string,
    body: string,
  ): Promise<string> {
    return this.sendMessage(`sendText ${phoneNumberId}`, phoneNumberId, token, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    });
  }

  async sendAudio(
    phoneNumberId: string,
    token: string,
    to: string,
    mediaId: string,
  ): Promise<string> {
    return this.sendMessage(
      `sendAudio ${phoneNumberId}`,
      phoneNumberId,
      token,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'audio',
        audio: { id: mediaId },
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
