const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calendarUrl, eventsBetween, weekStart } = require('../lib/calendar');

const ics = (body) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//FR\n${body}\nEND:VCALENDAR\n`;
const range = [new Date(Date.UTC(2026, 9, 12)), new Date(Date.UTC(2026, 9, 26))];

test('événement simple dans la période', () => {
  const events = eventsBetween(ics(`BEGIN:VEVENT
UID:a
DTSTART:20261014T090000Z
DTEND:20261014T100000Z
SUMMARY:Réunion
LOCATION:Salle 2
END:VEVENT`), ...range);
  assert.deepEqual(events, [{
    start: Date.UTC(2026, 9, 14, 9), end: Date.UTC(2026, 9, 14, 10), allDay: false, title: 'Réunion', location: 'Salle 2',
  }]);
});

test('journée entière : commence à minuit (heure locale)', () => {
  const [event] = eventsBetween(ics(`BEGIN:VEVENT
UID:b
DTSTART;VALUE=DATE:20261015
DTEND;VALUE=DATE:20261016
SUMMARY:Anniversaire
END:VEVENT`), ...range);
  assert.equal(event.allDay, true);
  assert.equal(event.start, new Date(2026, 9, 15).getTime());
});

test('répétition : date exclue et occurrence déplacée', () => {
  const events = eventsBetween(ics(`BEGIN:VEVENT
UID:c
DTSTART:20261001T080000Z
DTEND:20261001T090000Z
RRULE:FREQ=WEEKLY;COUNT=10
EXDATE:20261015T080000Z
SUMMARY:Cours
END:VEVENT
BEGIN:VEVENT
UID:c
RECURRENCE-ID:20261022T080000Z
DTSTART:20261022T120000Z
DTEND:20261022T130000Z
SUMMARY:Cours déplacé
END:VEVENT`), ...range);
  assert.deepEqual(events.map((e) => [e.title, e.start]), [['Cours déplacé', Date.UTC(2026, 9, 22, 12)]]);
});

test('fuseau horaire déclaré (Europe/Paris, heure d\'été)', () => {
  const [event] = eventsBetween(ics(`BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:d
DTSTART;TZID=Europe/Paris:20261014T090000
DTEND;TZID=Europe/Paris:20261014T100000
SUMMARY:Dentiste
END:VEVENT`), ...range);
  assert.equal(event.start, Date.UTC(2026, 9, 14, 7));
});

test('annulés, hors période, sans titre, fichier abîmé', () => {
  const events = eventsBetween(ics(`BEGIN:VEVENT
UID:e
DTSTART:20261014T090000Z
DTEND:20261014T100000Z
STATUS:CANCELLED
SUMMARY:Annulé
END:VEVENT
BEGIN:VEVENT
UID:f
DTSTART:20261201T090000Z
DTEND:20261201T100000Z
SUMMARY:Plus tard
END:VEVENT
BEGIN:VEVENT
UID:g
DTSTART:20261016T090000Z
DTEND:20261016T100000Z
END:VEVENT`), ...range);
  assert.deepEqual(events.map((e) => e.title), ['(Sans titre)']);
  assert.deepEqual(eventsBetween('pas un agenda', ...range), []);
  assert.deepEqual(eventsBetween('', ...range), []);
});

test('début de semaine : lundi à minuit', () => {
  assert.equal(weekStart(new Date(2026, 9, 15, 18, 30)).getTime(), new Date(2026, 9, 12).getTime());
  assert.equal(weekStart(new Date(2026, 9, 18, 23)).getTime(), new Date(2026, 9, 12).getTime());
  assert.equal(weekStart(new Date(2026, 9, 12)).getTime(), new Date(2026, 9, 12).getTime());
});

test('lien d\'agenda : https (webcal converti), sinon refusé', () => {
  assert.equal(calendarUrl('  webcal://p01-caldav.icloud.com/published/2/abc  '), 'https://p01-caldav.icloud.com/published/2/abc');
  assert.equal(calendarUrl('https://calendar.google.com/calendar/ical/x/basic.ics'), 'https://calendar.google.com/calendar/ical/x/basic.ics');
  for (const bad of ['http://exemple.fr/a.ics', 'file:///C:/a.ics', 'javascript:alert(1)', 'pas un lien', '', 42, `https://a.fr/${'x'.repeat(3000)}`]) {
    assert.equal(calendarUrl(bad), null, String(bad).slice(0, 30));
  }
});
