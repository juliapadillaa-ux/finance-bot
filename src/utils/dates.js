import { DateTime } from 'luxon';

const WEEKDAYS_ES = {
  lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6, domingo: 7,
};

const MONTHS_ES = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, sep: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

export function nowInTZ(tz) {
  return DateTime.now().setZone(tz);
}

export function toISODate(dt) {
  return dt.toISODate(); // YYYY-MM-DD
}

/**
 * Parse “hoy”, “ayer”, “lunes”, “15 marzo”, “15/03”, “2026-02-15”, etc.
 * Retorna DateTime o null.
 */
export function parseSpanishDate(text, tz) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  const base = nowInTZ(tz).startOf('day');

  if (s.includes('hoy')) return base;
  if (s.includes('ayer')) return base.minus({ days: 1 });

  // ISO / yyyy-mm-dd
  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const dt = DateTime.fromISO(iso[0], { zone: tz });
    return dt.isValid ? dt.startOf('day') : null;
  }

  // dd/mm(/yyyy) o dd-mm(-yyyy)
  const dmy = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = dmy[3] ? Number(dmy[3]) : base.year;
    const dt = DateTime.fromObject({ year, month, day }, { zone: tz });
    return dt.isValid ? dt.startOf('day') : null;
  }

  // "15 marzo" / "15 mar"
  const dm = s.match(/\b(\d{1,2})\s+([a-záéíóúñ]+)\b/);
  if (dm) {
    const day = Number(dm[1]);
    const monKey = dm[2].normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const month = MONTHS_ES[monKey];
    if (month) {
      const dt = DateTime.fromObject({ year: base.year, month, day }, { zone: tz });
      // Si cae en el futuro “lejano” (ej hoy feb y ponen dic), puedes decidir si es año pasado. Aquí: si > hoy+7d, restar 1 año.
      if (dt.isValid) {
        const candidate = dt.startOf('day');
        if (candidate > base.plus({ days: 7 })) return candidate.minus({ years: 1 });
        return candidate;
      }
    }
  }

  // weekday ("lunes") → último día que ocurrió (incluye hoy si coincide)
  for (const [name, wd] of Object.entries(WEEKDAYS_ES)) {
    if (s.includes(name)) {
      const diff = (base.weekday - wd + 7) % 7;
      return base.minus({ days: diff });
    }
  }

  return null;
}
