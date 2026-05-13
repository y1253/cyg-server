import { Injectable } from '@nestjs/common';
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

    const res = await fetch(`${this.baseUrl}/photo/v2`, {
      method: 'POST',
      headers: { token: this.apiKey },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Luxand enroll failed: ${res.status} ${body}`);
    }

    const data = await res.json() as { uuid: string };
    return data.uuid;
  }

  async searchFace(photo: Buffer, mimeType: string): Promise<{ uuid: string; probability: number } | null> {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(photo)], { type: mimeType }), 'photo.jpg');

    const res = await fetch(`${this.baseUrl}/photo/v2/search`, {
      method: 'POST',
      headers: { token: this.apiKey },
      body: form,
    });

    if (!res.ok) return null;

    const data = await res.json() as Array<{ uuid: string; probability: number }>;
    if (!Array.isArray(data) || data.length === 0) return null;

    const top = data[0];
    if (top.probability < this.minConfidence) return null;

    return { uuid: top.uuid, probability: top.probability };
  }

  async deletePerson(uuid: string): Promise<void> {
    await fetch(`${this.baseUrl}/photo/v2/${uuid}`, {
      method: 'DELETE',
      headers: { token: this.apiKey },
    });
  }
}
