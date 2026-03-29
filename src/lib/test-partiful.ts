import 'dotenv/config';
import { getCreatedEvents, getUpcomingEvents, getPastEvents, getEventPermission, getContacts, getMyUserDoc, getEventGuests } from '@keg/partiful-api';

const EVENT_ID = process.argv[2];

async function test(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`${label} ... `);
  try {
    const result = await fn();
    console.log('✓');
    console.log(JSON.stringify(result, null, 2).split('\n').slice(0, 15).join('\n'));
    console.log();
  } catch (err: any) {
    console.log('✗');
    console.log(' ', err.message);
    console.log();
  }
}

async function run() {
  console.log('Testing Partiful API (api.partiful.com)\n');

  await test('getCreatedEvents', getCreatedEvents);
  await test('getUpcomingEvents', getUpcomingEvents);
  await test('getPastEvents', getPastEvents);
  await test('getContacts', getContacts);

  await test('getMyUserDoc (Firestore)', getMyUserDoc);

  if (EVENT_ID) {
    await test(`getEventPermission(${EVENT_ID})`, () => getEventPermission(EVENT_ID));
    await test(`getEventGuests(${EVENT_ID}) [Firestore]`, async () => {
      const guests = await getEventGuests(EVENT_ID);
      const going = guests.filter(g => g.status === 'GOING');
      const maybe = guests.filter(g => g.status === 'MAYBE');
      const notGoing = guests.filter(g => g.status === 'NOT_GOING');
      console.log(`  ${going.length} going, ${maybe.length} maybe, ${notGoing.length} not going`);
      console.log('  Going:');
      going.forEach(g => console.log(`    - ${g.name} (count: ${g.count})`));
      return guests;
    });
  } else {
    console.log('Tip: pass an event ID to also test event-specific endpoints:');
    console.log('  npm run test:partiful -- <eventId>\n');
    console.log('  Your vball event ID: fZze0vVmmgdXh55ovvsU');
  }
}

run().catch(console.error);
