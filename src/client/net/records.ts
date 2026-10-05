import type { LapRecord } from '../../shared/net/protocol';

/** Classement en ligne des meilleurs tours (API HTTP du serveur). */
export async function fetchRecords(trackId: string): Promise<LapRecord[]> {
  const res = await fetch(`/api/records?track=${encodeURIComponent(trackId)}`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()).records as LapRecord[];
}

/** Propose un tour au classement ; renvoie la place obtenue (0 si hors classement). */
export async function submitRecord(trackId: string, name: string, ticks: number, carId: number): Promise<number> {
  try {
    const res = await fetch('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trackId, name, ticks, carId }),
    });
    if (!res.ok) return 0;
    return (await res.json()).place ?? 0;
  } catch {
    return 0;
  }
}
