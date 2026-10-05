import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CAR } from '../../shared/cars/physics';
import { CARS } from '../../shared/cars/carAtlas';
import { TICK_RATE } from '../../shared/constants';
import { getTrack } from '../../shared/track/track';
import { isOfficialTrack } from '../../shared/track/tracks';
import type { LapRecord } from '../../shared/net/protocol';

const TOP = 10;
const MAX_NAME = 12;

/**
 * Classement des meilleurs tours par circuit officiel, gardé dans un fichier JSON.
 * Les tours des courses en ligne sont enregistrés par le serveur ; ceux du solo et du
 * contre-la-montre sont envoyés par le client et seulement vérifiés pour leur vraisemblance.
 */
export class Records {
  private data: Record<string, LapRecord[]> = {};
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.warn('Classement illisible, on repart de zéro :', (e as Error).message);
    }
  }

  top(trackId: string): LapRecord[] {
    return this.data[trackId] ?? [];
  }

  /** Ajoute un tour s'il est vraisemblable ; renvoie sa place (1 = record) ou 0. */
  add(trackId: string, rec: LapRecord): number {
    if (!isOfficialTrack(trackId)) return 0;
    const name = String(rec.name ?? '').trim().slice(0, MAX_NAME);
    const ticks = Math.round(Number(rec.ticks));
    const carId = Math.round(Number(rec.carId));
    if (!name || !Number.isFinite(ticks) || !CARS[carId]) return 0;
    // Plus rapide que la piste parcourue à vitesse turbo sans freiner : impossible.
    const minTicks = (getTrack(trackId).length / (CAR.maxSpeed * 1.5)) * TICK_RATE;
    if (ticks < minTicks || ticks > 10 * 60 * TICK_RATE) return 0;
    const list = this.data[trackId] ?? [];
    // Un seul temps par pseudo : on garde le meilleur.
    const existing = list.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (existing && existing.ticks <= ticks) return 0;
    const next = list.filter((r) => r !== existing);
    next.push({ name, ticks, carId, at: new Date().toISOString().slice(0, 10), online: !!rec.online });
    next.sort((a, b) => a.ticks - b.ticks);
    this.data[trackId] = next.slice(0, TOP);
    const place = this.data[trackId].findIndex((r) => r.name === name && r.ticks === ticks) + 1;
    if (place) this.scheduleSave();
    return place;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(this.data, null, 1));
      } catch (e) {
        console.warn("Impossible d'enregistrer le classement :", (e as Error).message);
      }
    }, 1000);
  }

  /** API HTTP : GET /api/records?track=ID, POST /api/records {trackId, name, ticks, carId}. */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/api/records') return false;
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET') {
      json(200, { trackId: url.searchParams.get('track'), records: this.top(url.searchParams.get('track') ?? '') });
      return true;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 2000) req.destroy();
      });
      req.on('end', () => {
        try {
          const b = JSON.parse(body);
          const place = this.add(String(b.trackId), { name: b.name, ticks: b.ticks, carId: b.carId, at: '', online: false });
          json(200, { place, records: this.top(String(b.trackId)) });
        } catch {
          json(400, { error: 'requête invalide' });
        }
      });
      return true;
    }
    json(405, { error: 'méthode non autorisée' });
    return true;
  }
}
