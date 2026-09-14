import type { CalendarEvent } from '../store/events.ts';

/**
 * iCalendar (RFC 5545) feed of the app's events. Google Calendar (and Apple
 * Calendar, Outlook) can import this file or subscribe to its URL. Timed
 * events use floating local time — right for "2:30pm at my place" semantics.
 */

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function basicDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(events: CalendarEvent[], now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Manifest Analyzer//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Manifest Analyzer',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:evt-${e.id}@manifest-analyzer.local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SUMMARY:${escapeText(`[${e.kind}] ${e.title}`)}`);
    if (e.time) {
      const start = `${basicDate(e.date)}T${e.time.replace(':', '')}00`;
      const [h, m] = e.time.split(':').map(Number);
      const endDate = new Date(Date.UTC(2000, 0, 1, h, m));
      endDate.setUTCHours(endDate.getUTCHours() + 1);
      const endDay = endDate.getUTCDate() > 1 ? nextDay(e.date) : e.date;
      const end = `${basicDate(endDay)}T${String(endDate.getUTCHours()).padStart(2, '0')}${String(endDate.getUTCMinutes()).padStart(2, '0')}00`;
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${basicDate(e.date)}`);
      lines.push(`DTEND;VALUE=DATE:${basicDate(nextDay(e.date))}`);
    }
    const details = [e.contact, e.note].filter(Boolean).join(' — ');
    if (details) lines.push(`DESCRIPTION:${escapeText(details)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
