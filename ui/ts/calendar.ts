// Agendas iCal (liens ou fichiers .ics) : lecture des événements d'une période.
// Le texte est téléchargé et gardé par Rust (calendar.rs) ; ici il est seulement lu (titre, lieu, horaires).
import ICAL from '../vendor/ical.js';

const MAX_TEXT = 200;
const MAX_OCCURRENCES = 20000; // garde-fou pour les répétitions sans fin (ex. tous les jours depuis 20 ans)

export interface CalendarEvent {
  start: number;
  end: number;
  allDay: boolean;
  title: string;
  location: string;
}

// Lundi 00:00 (heure locale) de la semaine de « date ».
export function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function occurrence(startTime: ICAL.Time, endTime: ICAL.Time | null, event: ICAL.Event): CalendarEvent {
  return {
    start: startTime.toJSDate().getTime(),
    end: (endTime ?? startTime).toJSDate().getTime(),
    allDay: startTime.isDate,
    title: text(event.summary, '(Sans titre)'),
    location: text(event.location),
  };
}

// Événements (et occurrences des événements répétés) qui touchent la période [from, to[, triés.
export function eventsBetween(icsText: string, from: Date, to: Date): CalendarEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(icsText));
    if (root.name !== 'vcalendar') return [];
  } catch {
    return [];
  }
  const fromMs = from.getTime();
  const toMs = to.getTime();
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(zone);
    } catch {
      // Fuseau mal décrit : les heures seront lues comme locales.
    }
  }

  // Les occurrences modifiées (RECURRENCE-ID) sont rattachées à leur événement répété.
  const events: ICAL.Event[] = [];
  const recurring = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const component of root.getAllSubcomponents('vevent')) {
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) exceptions.push(event);
    else {
      events.push(event);
      if (event.isRecurring()) recurring.set(event.uid, event);
    }
  }
  for (const exception of exceptions) {
    const master = recurring.get(exception.uid);
    if (master) master.relateException(exception);
    else events.push(exception);
  }

  const found: CalendarEvent[] = [];
  const touches = (item: CalendarEvent) => item.start < toMs && Math.max(item.end, item.start + 1) > fromMs;
  for (const event of events) {
    try {
      if (!event.isRecurring()) {
        const item = occurrence(event.startDate, event.endDate, event);
        if (touches(item)) found.push(item);
        continue;
      }
      const iterator = event.iterator();
      for (let next = iterator.next(), n = 0; next && n < MAX_OCCURRENCES; next = iterator.next(), n++) {
        if (next.toJSDate().getTime() >= toMs) break;
        const details = event.getOccurrenceDetails(next);
        if (details.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
        const item = occurrence(details.startDate, details.endDate, details.item);
        if (touches(item)) found.push(item);
      }
    } catch {
      // Un événement illisible ne doit pas empêcher d'afficher les autres.
    }
  }
  return found.sort((a, b) => a.start - b.start || a.end - b.end);
}
