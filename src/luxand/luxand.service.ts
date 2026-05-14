import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LuxandService {
  private readonly baseUrl = 'https://api.luxand.cloud';
  private readonly apiKey: string;
  private readonly minConfidence: number;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('LUXAND_API_KEY');
    this.minConfidence = parseFloat(config.get<string>('LUXAND_MIN_CONFIDENCE') ?? '0.85');
  }

  async enrollPerson(name: string, photo: Buffer, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(photo)], { type: mimeType }), 'photo.jpg');
    form.append('name', name);

    const res = await fetch(`${this.baseUrl}/subject/v2`, {
      method: 'POST',
      headers: { token: this.apiKey },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadGatewayException(`Luxand enroll failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { id?: number | string; error?: string };
    if (!data.id) {
      throw new BadGatewayException(`Luxand enroll response missing id: ${JSON.stringify(data)}`);
    }
    return String(data.id);
  }

  async searchFace(photo: Buffer, mimeType: string): Promise<{ uuid: string; probability: number } | null> {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(photo)], { type: mimeType }), 'photo.jpg');

    const res = await fetch(`${this.baseUrl}/photo/search`, {
      method: 'POST',
      headers: { token: this.apiKey },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadGatewayException(`Luxand search failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { status?: string; id?: number | string; probability?: number; confidence?: number; error?: string } | Array<{ uuid?: string; id?: number | string; probability?: number; confidence?: number }>;

    // Handle both array and single-object response shapes
    let id: string | undefined;
    let score: number | undefined;

    if (Array.isArray(data)) {
      if (data.length === 0) return null;
      const top = data[0];
      id = top.uuid ? String(top.uuid) : top.id != null ? String(top.id) : undefined;
      score = top.probability ?? top.confidence;
    } else {
      if (data.status !== 'success') return null;
      id = data.id != null ? String(data.id) : undefined;
      score = data.confidence ?? data.probability;
    }

    if (!id || score === undefined) return null;
    if (score < this.minConfidence) return null;

    return { uuid: id, probability: score };
  }

  async deletePerson(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/subject/v2/${id}`, {
      method: 'DELETE',
      headers: { token: this.apiKey },
    });
  }
}
