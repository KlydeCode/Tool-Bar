// Agendas iCal (liens ou fichiers .ics) : lecture des événements d'une période.
// Le contenu vient d'Internet : il n'est jamais exécuté, seulement lu (titre, lieu, horaires).
const icalModule = require('ical.js');

const ICAL = icalModule.default ?? icalModule;
const MAX_TEXT = 200;
const MAX_OCCURRENCES = 20000; // garde-fou pour les répétitions sans fin (ex. tous les jours depuis 20 ans)

// Lien collé par l'utilisateur → adresse https à télécharger, ou null.
// webcal:// (iCloud, Outlook) est le même lien en https.
function calendarUrl(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().replace(/^webcal:\/\//i, 'https://');
  if (text.length > 2000) return null;
  try {
    return new URL(text).protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
}

// Lundi 00:00 (heure locale) de la semaine de « date ».
function weekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function occurrence(startTime, endTime, event) {
  return {
    start: startTime.toJSDate().getTime(),
    end: (endTime ?? startTime).toJSDate().getTime(),
    allDay: startTime.isDate,
    title: text(event.summary, '(Sans titre)'),
    location: text(event.location),
  };
}

// Événements (et occurrences des événements répétés) qui touchent la période [from, to[, triés.
function eventsBetween(icsText, from, to) {
  let root;
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
  const events = [];
  const recurring = new Map();
  const exceptions = [];
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

  const found = [];
  for (const event of events) {
    try {
      if (!event.isRecurring()) {
        const item = occurrence(event.startDate, event.endDate, event);
        if (item.start < toMs && Math.max(item.end, item.start + 1) > fromMs) found.push(item);
        continue;
      }
      const iterator = event.iterator();
      for (let next = iterator.next(), n = 0; next && n < MAX_OCCURRENCES; next = iterator.next(), n++) {
        if (next.toJSDate().getTime() >= toMs) break;
        const details = event.getOccurrenceDetails(next);
        if (details.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
        const item = occurrence(details.startDate, details.endDate, details.item);
        if (item.start < toMs && Math.max(item.end, item.start + 1) > fromMs) found.push(item);
      }
    } catch {
      // Un événement illisible ne doit pas empêcher d'afficher les autres.
    }
  }
  return found.sort((a, b) => a.start - b.start || a.end - b.end);
}

module.exports = { calendarUrl, eventsBetween, weekStart };
