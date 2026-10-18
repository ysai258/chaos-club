import { test, expect, type Page } from '@playwright/test'
import { clueProblem } from '../../src/games/overheard/logic.ts'
import { setUpLobby, start, startFilm, tap, tts, type Film } from '../kit.ts'

/**
 * Overheard, how to play. Six phones, two teams of three.
 * Round 1 in full (both teams decode, rivals only listen), round 2 up to an
 * interception, then a cut to the second wiretap and the results.
 *
 * Keywords and codes are random, so clues come from a table with three clues
 * per keyword: rounds 1 and 2 point the same way, which makes the round 2
 * interception something a sharp listener really could pull off.
 */

// CLUES-BEGIN
/** Three clues per keyword: [round 1, round 2, round 3]. Rounds 1 and 2 point the same way, so a sharp rival can link them. */
const CLUES: Record<string, [string, string, string]> = {
  Biryani: ['Hyderabad', 'Nizam', 'Dum'],
  Chai: ['Tapri', 'Cutting', 'Kettle'],
  Samosa: ['Triangle', 'Three corners', 'Aloo filling'],
  Mango: ['Alphonso', 'Ratnagiri', 'Aamras'],
  'Pani Puri': ['Golgappa', 'Phuchka', 'Spicy water'],
  Dosa: ['Udupi', 'Sambar', 'Tawa'],
  Jalebi: ['Spiral', 'Swirl', 'Rabri'],
  Pickle: ['Achaar', 'Nani’s jar', 'Brine'],
  Lassi: ['Amritsar', 'Punjab', 'Curd shake'],
  Paneer: ['Tikka', 'Cottage cheese', 'Palak'],
  Chutney: ['Mint', 'Green dip', 'Imli'],
  Ghee: ['Clarified', 'Desi butter', 'Tadka'],
  Tiffin: ['Lunchbox', 'Steel boxes', 'Office lunch'],
  Masala: ['Spice mix', 'Garam', 'MDH'],
  Coconut: ['Nariyal', 'Kerala', 'Coir'],
  'Vada Pav': ['Mumbai snack', 'Dadar station', 'Batata'],
  Kulfi: ['Malai', 'Matka', 'Pista'],
  'Pressure Cooker': ['Whistle', 'Three whistles', 'Hawkins'],
  Thali: ['Gujarati meal', 'Many katoris', 'Steel plate'],
  Maggi: ['Two minutes', 'Instant', 'Yellow pack'],
  Monsoon: ['Barish', 'Rainy season', 'June'],
  'Auto-rickshaw': ['Three wheels', 'Tuk tuk', 'Meter down'],
  Cricket: ['Sachin', 'Kohli', 'Wicket'],
  Bollywood: ['Shah Rukh', 'Salman', 'Filmy'],
  Wedding: ['Shaadi', 'Pheras', 'Band baaja'],
  Diwali: ['Diyas', 'Lakshmi puja', 'Crackers'],
  Holi: ['Gulal', 'Pichkari', 'Colours'],
  Rangoli: ['Floor art', 'Coloured powder', 'Kolam'],
  Mehendi: ['Henna', 'Hand designs', 'Bridal'],
  Saree: ['Six yards', 'Pallu', 'Kanjeevaram'],
  Aunty: ['Sharmaji', 'Log kya kahenge', 'Kitty party'],
  Jugaad: ['Hack', 'Desi fix', 'Duct tape'],
  Traffic: ['Silk Board', 'Red signal', 'Honking'],
  Train: ['Local', 'Platform', 'Rajdhani'],
  Temple: ['Bells', 'Prasad', 'Pujari'],
  Kite: ['Manja', 'Sankranti', 'Patang'],
  Peacock: ['National bird', 'Feathers', 'Mor'],
  Elephant: ['Haathi', 'Ganesha', 'Ivory'],
  Tiger: ['Royal Bengal', 'Sundarbans', 'Stripes'],
  Cow: ['Moo', 'Milk', 'Gau mata'],
  Horn: ['Honk', 'Pom pom', 'Rhino'],
  Scooter: ['Activa', 'Vespa', 'Two wheeler'],
  Hostel: ['Warden', 'Roommate', 'Mess food'],
  Exam: ['Board', 'Results', 'Invigilator'],
  Tuition: ['Coaching', 'Kota', 'Extra class'],
  Engineer: ['IIT', 'B.Tech', 'Hard hat'],
  Startup: ['Founder', 'Funding', 'Bengaluru'],
  Goa: ['Beach', 'Baga', 'Feni'],
  Himalaya: ['Everest', 'Sherpa', 'Kailash'],
  Ganga: ['Varanasi', 'Ghats', 'Haridwar'],
  Rupee: ['Paisa', 'Hundred', 'RBI'],
  Dabba: ['Steel box', 'Lunch carrier', 'Container'],
  Gossip: ['Rumour', 'Chugli', 'Whispers'],
  Neighbour: ['Next door', 'Padosi', 'Sugar borrow'],
  'Power Cut': ['Load shedding', 'Darkness', 'Electricity gone'],
  Inverter: ['Backup', 'Battery', 'Luminous'],
  Dhaba: ['Highway', 'Truckers', 'Charpai'],
  Antakshari: ['Song chain', 'Last letter', 'Road trip'],
  Sangeet: ['Dance night', 'Choreography', 'Dholki'],
  Baraat: ['Ghodi', 'Groom horse', 'Band'],
  Lungi: ['Mundu', 'Chennai Express', 'Wraparound'],
  Turban: ['Pagdi', 'Safa', 'Sardar'],
  Bindi: ['Forehead', 'Red dot', 'Sticker'],
  Bangle: ['Chudi', 'Glass bracelet', 'Wrist'],
  Tabla: ['Zakir', 'Wah Taj', 'Dha dhin'],
  Sitar: ['Ravi Shankar', 'Strings', 'Raga'],
  Yoga: ['Asana', 'Downward dog', 'Ramdev'],
  Ayurveda: ['Herbal', 'Patanjali', 'Kerala massage'],
  Cobra: ['Snake charmer', 'Been', 'Hood'],
  Mosquito: ['Dengue', 'Good Knight', 'Buzz'],
  Umbrella: ['Rain', 'Brolly', 'Mary Poppins'],
  Mirror: ['Reflection', 'Snow White', 'Glass'],
  Ladder: ['Rungs', 'Climb', 'Snakes and'],
  Candle: ['Wax', 'Birthday', 'Flame'],
  Clock: ['Tick tock', 'Alarm', 'Big Ben'],
  Pillow: ['Cushion', 'Sleep', 'Soft'],
  Padlock: ['Key', 'Godrej', 'Chain'],
  Bridge: ['Howrah', 'Golden Gate', 'Sea link'],
  Rocket: ['ISRO', 'Chandrayaan', 'Launch'],
  Anchor: ['Ship', 'Sailor', 'News host'],
  Balloon: ['Helium', 'Pop', 'Party'],
  Crown: ['Royal', 'Tiara', 'Kohinoor'],
  Diamond: ['Carat', 'Ring', 'Sparkle'],
  Ghost: ['Bhoot', 'Haunted', 'Casper'],
  Pirate: ['Jack Sparrow', 'Eye patch', 'Plank'],
  Robot: ['Chitti', 'Rajinikanth', 'Beep boop'],
  Vampire: ['Dracula', 'Fangs', 'Twilight'],
  Wizard: ['Harry Potter', 'Hogwarts', 'Wand'],
  Ninja: ['Hattori', 'Shuriken', 'Turtles'],
  Mermaid: ['Ariel', 'Fish tail', 'Siren'],
  Dragon: ['Fire breath', 'Game of Thrones', 'Komodo'],
  Unicorn: ['Magical horse', 'Pegasus cousin', 'Billion dollar'],
  Zombie: ['Walking dead', 'Undead', 'Apocalypse'],
  Alien: ['UFO', 'Martian', 'ET'],
  Dinosaur: ['Jurassic', 'T-Rex', 'Fossil'],
  Penguin: ['Antarctica', 'Happy Feet', 'Tuxedo bird'],
  Octopus: ['Eight arms', 'Tentacles', 'Ink'],
  Shark: ['Jaws', 'Fin', 'Great white'],
  Spider: ['Web', 'Eight legs', 'Peter Parker'],
  Bee: ['Hive', 'Pollen', 'Sting'],
  Owl: ['Hoot', 'Night bird', 'Hedwig'],
  Parrot: ['Mithu', 'Talks back', 'Green bird'],
  Monkey: ['Bandar', 'Hanuman', 'Zoo swing'],
  Camel: ['Rajasthan', 'Pushkar', 'Hump'],
  Snail: ['Slow', 'Slime', 'Escargot'],
  Volcano: ['Lava', 'Eruption', 'Vesuvius'],
  Desert: ['Thar', 'Sahara', 'Sand dunes'],
  Island: ['Andaman', 'Maldives', 'Castaway'],
  Jungle: ['Mowgli', 'Baloo', 'Amazon'],
  Moon: ['Chanda Mama', 'Lunar', 'Crater'],
  Comet: ['Halley', 'Tail', 'Shooting star'],
  Sun: ['Surya', 'Ravi', 'Solar'],
  Rainbow: ['VIBGYOR', 'Seven colours', 'Pot of gold'],
  Thunder: ['Lightning', 'Thor', 'Rumble'],
  Snow: ['Manali', 'Gulmarg', 'Flakes'],
  Ocean: ['Pacific', 'Atlantic', 'Deep blue'],
  River: ['Brahmaputra', 'Yamuna', 'Flowing'],
  Mountain: ['Peak', 'Summit', 'Trek'],
  Cave: ['Ajanta', 'Ellora', 'Stalactite'],
  Forest: ['Woods', 'Trees', 'Gir'],
  Bat: ['Willow', 'Sixer', 'Night flyer'],
  Bank: ['SBI', 'Locker', 'Loan'],
  Ludo: ['Dice', 'Six to start', 'Lockdown game'],
  Pitch: ['22 yards', 'Curator', 'Sales talk'],
  Bark: ['Woof', 'Dog', 'Tree skin'],
  Kabaddi: ['Raid', 'Pro League', 'Breath hold'],
  Club: ['Disco', 'Members only', 'Golf'],
  Date: ['Calendar', 'Tarikh', 'Khajoor'],
  Fan: ['Ceiling', 'Usha', 'Followers'],
  Match: ['Rishta', 'Arranged', 'Lighter'],
  Mouse: ['Click', 'Cursor', 'Jerry'],
  Carrom: ['Striker', 'Board game', 'Powder'],
  Note: ['Currency', 'Demonetisation', 'Sticky'],
  Organ: ['Kidney', 'Liver', 'Pipe music'],
  Palm: ['Hand', 'Fortune teller', 'Oasis tree'],
  Seal: ['Stamp', 'Envelope', 'Arctic flipper'],
  Spring: ['Coil', 'Bounce', 'Season'],
  Tank: ['Army', 'Battle', 'Petrol'],
  Trunk: ['Car boot', 'Dickey', 'Suitcase'],
  Wave: ['Hello', 'Bye bye', 'Tsunami'],
  Cell: ['Jail', 'Lockup', 'Biology'],
  Charge: ['Plug in', 'Battery low', 'Attack'],
  Crane: ['Construction', 'Lift', 'Bird'],
  Jam: ['Kissan', 'Toast', 'Gridlock'],
  Mine: ['Coal', 'Dhanbad', 'Gold dig'],
  Pupil: ['Eye', 'Iris', 'Student'],
  Ruler: ['Geometry box', 'Inches', 'Emperor'],
  Scale: ['Weighing', 'Kilogram', 'Music notes'],
  Shell: ['Beach find', 'Conch', 'Turtle'],
  Tie: ['Knot', 'Windsor', 'Draw'],
  'Wi-Fi': ['Password', 'Router', 'Hotspot'],
  Selfie: ['Pout', 'Duck face', 'Phone pic'],
  Meme: ['Viral', 'Funny pic', 'Template'],
  Podcast: ['Episode', 'Spotify', 'Rogan'],
  Emoji: ['Smiley', 'Thumbs up', 'Unicode'],
  OTP: ['Six digits', 'SMS', 'Verify'],
  Headphones: ['Noise cancel', 'Over ear', 'Boat'],
  Instagram: ['Reels', 'Stories', 'Filters'],
  Netflix: ['Binge', 'Sacred Games', 'Chill'],
  Influencer: ['Sponsored', 'Brand deal', 'Blue tick'],
  Gym: ['Protein', 'Biceps', 'Treadmill'],
  Pizza: ['Dominos', 'Pepperoni', 'Margherita'],
  Coffee: ['Filter kaapi', 'Espresso', 'Starbucks'],
  Sushi: ['Japan', 'Raw fish', 'Wasabi'],
  Burger: ['McDonalds', 'Patty', 'Bun'],
  Chocolate: ['Dairy Milk', 'Cadbury', 'Cocoa'],
  Popcorn: ['Movie snack', 'Multiplex', 'Kernels'],
  'Ice Cream': ['Cone', 'Scoop', 'Vanilla'],
  Cake: ['Cherry on top', 'Bakery', 'Icing'],
  Noodles: ['Chopsticks', 'Hakka', 'Ramen'],
  Hospital: ['ICU', 'Ward', 'Nurse'],
  Prison: ['Tihar', 'Behind bars', 'Inmate'],
  Museum: ['Exhibits', 'Louvre', 'Artifacts'],
  Airport: ['Runway', 'Terminal', 'Boarding pass'],
  Circus: ['Clown', 'Ringmaster', 'Trapeze'],
  Casino: ['Poker', 'Vegas', 'Roulette'],
  Library: ['Books', 'Silence', 'Shelves'],
  Castle: ['Moat', 'Fort', 'Drawbridge'],
  Pyramid: ['Egypt', 'Pharaoh', 'Giza'],
  Lighthouse: ['Beacon', 'Coast guide', 'Keeper'],
  Doctor: ['Stethoscope', 'Prescription', 'Clinic'],
  Detective: ['Sherlock', 'Byomkesh', 'Magnifier'],
  Chef: ['Kitchen', 'Apron', 'Recipe'],
  Astronaut: ['Rakesh Sharma', 'Spacesuit', 'Zero gravity'],
  King: ['Throne', 'Raja', 'Majesty'],
  Queen: ['Rani', 'Freddie', 'Elizabeth'],
  Soldier: ['Jawan', 'Fauji', 'Border'],
  Teacher: ['Chalk', 'Blackboard', 'Homework'],
  Thief: ['Chor', 'Robber', 'Pickpocket'],
  Spy: ['Bond', 'Secret agent', 'Pathaan'],
  Guitar: ['Acoustic', 'Six strings', 'Rockstar'],
  Piano: ['Keys', 'Black and white', 'Mozart'],
  Drum: ['Dhol', 'Beat', 'Snare'],
  Microphone: ['Mic drop', 'Karaoke', 'Podium'],
  Camera: ['Lens', 'Shutter', 'Canon'],
  Telescope: ['Stars', 'Galileo', 'Hubble'],
  Magnet: ['North pole', 'Attract', 'Fridge'],
  Compass: ['North', 'Needle', 'Direction'],
  Map: ['Atlas', 'Google', 'Directions'],
  Treasure: ['X marks the spot', 'Buried gold', 'Chest'],
  Bomb: ['Explode', 'Boom', 'Diffuse'],
  Sword: ['Talwar', 'Blade', 'Excalibur'],
  Shield: ['Captain America', 'Armour', 'Defence'],
  Arrow: ['Arjun', 'Bow', 'Cupid'],
  Cannon: ['Gunpowder', 'Fort gun', 'Big blast'],
  Laser: ['Beam', 'Pointer', 'Star Wars'],
  Igloo: ['Eskimo', 'Ice house', 'Inuit'],
  Skeleton: ['Bones', 'Skull', 'Halloween'],
  Mummy: ['Bandages', 'Tomb', 'Maa'],
  Witch: ['Broomstick', 'Cauldron', 'Chudail'],
  Football: ['Messi', 'Ronaldo', 'Goal'],
  Chess: ['Checkmate', 'Anand', 'Pawn'],
  Olympics: ['Neeraj', 'Gold medal', 'Five rings'],
  Marathon: ['42 km', 'Long run', 'Finish line'],
  Boxing: ['Mary Kom', 'Gloves', 'Knockout'],
  Swimming: ['Pool', 'Freestyle', 'Goggles'],
  Bicycle: ['Pedal', 'Hero cycle', 'Bell'],
  Helicopter: ['Chopper', 'Rotor', 'Dhoni shot'],
  Submarine: ['Underwater', 'Periscope', 'Navy'],
  Taxi: ['Yellow cab', 'Uber', 'Meter'],
  Honey: ['Shahad', 'Pooh bear', 'Hive gold'],
  Salt: ['Namak', 'Dandi march', 'Seasoning'],
  Pepper: ['Kali mirch', 'Black spice', 'Sneeze'],
  Lemon: ['Nimbu', 'Sour', 'Shikanji'],
  Onion: ['Pyaz', 'Tears', 'Layers'],
  Garlic: ['Lehsun', 'Bad breath', 'Cloves'],
  Potato: ['Aloo', 'French fries', 'Mashed'],
  Banana: ['Kela', 'Peel', 'Minions'],
  Egg: ['Anda', 'Omelette', 'Yolk'],
  Bread: ['Loaf', 'Sandwich', 'Pav'],
  Shadow: ['Dark copy', 'Follows you', 'Silhouette'],
  Dream: ['Nightmare', 'REM', 'Inception'],
  Heart: ['Dil', 'Love', 'Cardio'],
  Brain: ['Dimaag', 'Genius', 'Neurons'],
  Tooth: ['Dentist', 'Molar', 'Fairy'],
  Beard: ['Stubble', 'Trimmer', 'No Shave Nov'],
  Tattoo: ['Body art', 'Permanent', 'Needle art'],
  Lipstick: ['Red pout', 'Makeup', 'Gloss'],
  Perfume: ['Fragrance', 'Scent', 'Deo'],
  Glasses: ['Specs', 'Chashma', 'Lenses'],
}
// CLUES-END

const N = {
  intro: 'Six friends on one Google Meet call, each on their own phone. Tonight: Overheard!',
  lobby: 'The host picks the game, splits everyone into two teams of three, and sets short timers.',
  words: 'Each team gets four secret words, numbered one to four. Here is the sheet for Asha’s team.',
  rivals: 'Ben’s team has four words too. On their rivals tab: no words at all, just blanks for guessing.',
  encryptor: 'Each round, one player per team is the encryptor. This round it’s Asha, and her phone shows a secret code.',
  clues: 'One clue per number. Easy for her own team, confusing for the rivals, because everyone will hear them.',
  sand: 'Ben has sent his clues first, so Asha’s timer drops to thirty seconds. Hurry, Asha!',
  onair: 'Now, the on-air moment. Asha reads each clue out loud on the call, then taps to show it.',
  popup: 'Every clue pops up on every phone, rivals included. Ben’s team hears all of it.',
  decode: 'Now Asha’s team cracks the code. Not out loud, the rivals are listening! They whisper in the private team chat.',
  pick: 'Chen taps a number for each clue, then locks it in. Anyone on the team can do this.',
  stat: 'Get your own code wrong, and your team takes a static token. Two static, and you lose.',
  reveal1: 'Decoded! The clues now sit under their numbers, on a sheet both teams can see.',
  ben: 'Then it’s Ben’s turn on air. Same drill: three clues, read out loud.',
  benDecode: 'Ben’s team decodes in their own chat. In round one, the rivals can’t guess yet. They just listen.',
  reveal2: 'Decoded again! Ben’s clues are now on the record, filed under their numbers.',
  round2: 'Round two: Chen and Dev encrypt, and now the rivals can intercept! Dev sees his team’s old clues under each word.',
  devAir: 'Dev goes on air first. This time, Asha’s team is listening very carefully.',
  intel: 'Their intel tab shows every clue Ben’s team has given, grouped by number. Time to play detective.',
  plot: 'They plot in team chat. Some of Dev’s clues sound a lot like Ben’s clues from last round!',
  tapRule: 'Esha locks it in. Guess the rivals’ code exactly, and you earn a wiretap token. Two wiretaps win the game.',
  wiretapped: 'Wiretapped! Asha’s team cracked Dev’s code without ever seeing his words.',
  results: 'One round later, Asha’s team pulls off a second wiretap, and wins the game!',
  outro: 'Be obvious to your team, baffling to theirs. Grab five friends, hop on a call, and play Overheard!',
}

const NAMES = ['Asha', 'Ben', 'Chen', 'Dev', 'Esha', 'Farhan']
const TEAM_A = ['Asha', 'Chen', 'Esha']
const TEAM_B = ['Ben', 'Dev', 'Farhan']
const ORDINAL = ['First clue', 'Second clue', 'Third clue']
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- reading the phones

async function waitPhase(film: Film, phase: string) {
  for (const n of NAMES) await expect(film.page(n).getByTestId('overheard')).toHaveAttribute('data-phase', phase, { timeout: 60_000 })
}

async function keywords(page: Page): Promise<string[]> {
  return Promise.all([1, 2, 3, 4].map(async (i) => (await page.getByTestId(`kw-${i}`).first().textContent())!.trim()))
}

async function codeOf(page: Page): Promise<number[]> {
  const raw = await page.getByTestId('my-code').getAttribute('data-code')
  return raw!.split('-').map(Number)
}

/** The table's clue for this keyword and round, or another of its clues if the rules forbid it. */
function cluesFor(code: number[], words: string[], round: number, used: string[]): string[] {
  const out: string[] = []
  for (const d of code) {
    const kw = words[d - 1]!
    const options = CLUES[kw] ?? ['Hmm', 'Think', 'Guess']
    const order = [round - 1, 0, 1, 2].map((i) => i % 3)
    const ok = order.map((i) => options[i]!).find((c) => !clueProblem(c, words, [...used, ...out]))
    out.push(ok ?? `Mystery ${out.length + 1}`)
  }
  return out
}

/** Scroll something to the middle of the phone, smoothly, so the viewer can follow. */
async function show(page: Page, testIdOrRole: ReturnType<Page['getByTestId']>, block: 'center' | 'start' = 'center') {
  await testIdOrRole.first().evaluate((el, b) => el.scrollIntoView({ block: b as ScrollLogicalPosition, behavior: 'smooth' }), block)
  await sleep(500)
}

async function typeClues(page: Page, clues: string[], from = 0, to = 3, delay = 0) {
  for (let i = from; i < to; i++) {
    const input = page.getByTestId(`clue-${i}`)
    if (delay) {
      await input.click()
      await input.pressSequentially(clues[i]!, { delay })
      await sleep(250)
    } else await input.fill(clues[i]!)
  }
}

async function sendClues(page: Page) {
  await tap(page.getByRole('button', { name: 'Send clues' }))
}

async function pickCode(page: Page, code: number[], gap = 0, lock = true) {
  for (let i = 0; i < 3; i++) {
    const btn = page.getByRole('radio', { name: `Clue ${i + 1} is ${code[i]}` })
    await tap(btn)
    await expect(btn).toHaveAttribute('aria-checked', 'true')
    if (gap) await sleep(gap)
  }
  if (lock) await lockIn(page, gap)
}

async function lockIn(page: Page, gap = 0) {
  await tap(page.getByRole('button', { name: /^Lock in/ }))
  if (gap) await sleep(gap)
  await page.getByRole('button', { name: /^Sure\? Lock/ }).click()
  await expect(page.getByRole('button', { name: /^Sure\? Lock/ })).toHaveCount(0)
}

async function openChat(page: Page) {
  if ((await page.getByLabel('Team chat message').count()) === 0) await page.getByTestId('team-chat-button').click()
  await expect(page.getByLabel('Team chat message')).toBeVisible()
}

async function chat(page: Page, text: string, delay = 0) {
  await openChat(page)
  const input = page.getByLabel('Team chat message')
  if (delay) await input.pressSequentially(text, { delay })
  else await input.fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('team-chat-list')).toContainText(text)
}

async function closeChat(page: Page) {
  if ((await page.getByLabel('Team chat message').count()) > 0) {
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('Team chat message')).toHaveCount(0)
  }
}

/** Encryptor reads one clue on the call, then taps. */
async function readAloud(film: Film, name: string, clue: string, i: number) {
  const page = film.page(name)
  await expect(page.getByTestId('onair-clue')).toContainText(clue)
  await film.shout(name, `${ORDINAL[i]}: ${clue}`, 2400)
  await tap(page.getByRole('button', { name: /I said it/ }))
  for (const n of NAMES) if (n !== name) await expect(film.page(n).getByTestId(`heard-${i}`).or(film.page(n).getByText(clue).first()).first()).toBeVisible()
}

async function nextIfReveal(film: Film) {
  const next = film.page('Asha').getByRole('button', { name: /Next/ })
  if ((await film.page('Asha').getByTestId('overheard').getAttribute('data-phase').catch(() => null)) === 'reveal' && (await next.isVisible())) await next.click().catch(() => {})
}

/** Fast transmission for the cut: read, guess, reveal, next. */
async function quickTransmission(film: Film, encryptor: string, clues: string[], code: number[], decoders: string[], interceptors: string[], intercept: boolean) {
  await waitPhase(film, 'transmit')
  const page = film.page(encryptor)
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('onair-clue')).toContainText(clues[i]!)
    await tap(page.getByRole('button', { name: /I said it/ }))
    await sleep(150)
  }
  await waitPhase(film, 'guess')
  const wrong = [code[1]!, code[0]!, code[2]!]
  await pickCode(film.page(interceptors[0]!), intercept ? code : wrong)
  await pickCode(film.page(decoders[0]!), code)
  await waitPhase(film, 'reveal')
  await sleep(600)
  await nextIfReveal(film)
}

// ---------------------------------------------------------------- the film

test('overheard', async ({ browser }) => {
  const teams = [TEAM_A, TEAM_B]
  const film = await startFilm(browser, { game: 'overheard', names: NAMES, teams, lines: Object.values(N) })
  const P = (n: string) => film.page(n)
  const pending: Promise<unknown>[] = []
  const pre = (line: string) => { const p = tts(line); pending.push(p); return line }

  // ---------------- lobby
  film.caption('Setting up')
  film.focus('Asha')
  const lobby = setUpLobby(film, { game: 'overheard', teams, settings: { maxRounds: 3, clueSeconds: '3 min', guessSeconds: '2 min' } })
  await film.say(N.intro)
  await film.sayWhile(N.lobby, () => lobby)
  await start(film)
  await waitPhase(film, 'encrypt')

  // Who encrypts round 1? The narration assumes Asha and Ben.
  for (const n of NAMES) expect(await P(n).getByTestId('my-code').count(), `${n} encryptor?`).toBe(n === 'Asha' || n === 'Ben' ? 1 : 0)
  const wordsA = await keywords(P('Chen'))
  const wordsB = await keywords(P('Dev'))
  const codeA1 = await codeOf(P('Asha'))
  const codeB1 = await codeOf(P('Ben'))
  const cluesA1 = cluesFor(codeA1, wordsA, 1, [])
  const cluesB1 = cluesFor(codeB1, wordsB, 1, [])
  const wordsLine = pre(`${wordsA[0]}, ${wordsA[1]}, ${wordsA[2]} and ${wordsA[3]}. Only Asha, Chen and Esha can see them.`)
  const codeLine = pre(`Her code is ${codeA1.join(', ')}. So she needs a clue for ${codeA1.map((d) => wordsA[d - 1]).join(', then ')}.`)

  // ---------------- secret words
  film.caption('Four secret words')
  film.focus(null)
  film.spotlight('Chen')
  await film.sayWhile(N.words, async () => { await show(P('Chen'), P('Chen').getByRole('tablist'), 'start'); await Promise.all(pending) })
  await film.say(wordsLine)
  film.spotlight('Dev')
  await film.sayWhile(N.rivals, async () => {
    await show(P('Dev'), P('Dev').getByRole('tablist'), 'start')
    await sleep(2500)
    await tap(P('Dev').getByRole('tab', { name: /Their intel/ }))
  })
  await film.pause(600)
  await tap(P('Dev').getByRole('tab', { name: /Our words/ }))

  // ---------------- round 1: clues
  film.caption('Round 1 · Writing clues')
  film.spotlight('Asha')
  await P('Asha').evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await film.say(N.encryptor)
  await film.say(codeLine)
  await film.sayWhile(N.clues, async () => {
    await typeClues(P('Asha'), cluesA1, 0, 2, 90)
    await typeClues(P('Ben'), cluesB1)
  })
  await sendClues(P('Ben'))
  await film.sayWhile(N.sand, async () => {
    await typeClues(P('Asha'), cluesA1, 2, 3, 90)
  })
  await sendClues(P('Asha'))

  // ---------------- round 1: Asha on air
  await waitPhase(film, 'transmit')
  film.caption('On air')
  await film.say(N.onair)
  await readAloud(film, 'Asha', cluesA1[0]!, 0)
  film.spotlight('Ben')
  await film.sayWhile(N.popup, async () => {
    await readAloud(film, 'Asha', cluesA1[1]!, 1)
  })
  await readAloud(film, 'Asha', cluesA1[2]!, 2)
  await waitPhase(film, 'guess')
  film.bubble('Ben', 'Hmm. Noted!', 2000)

  // ---------------- round 1: decoding in team chat
  film.caption('Decoding in team chat')
  film.spotlight('Chen')
  await film.sayWhile(N.decode, async () => {
    await openChat(P('Chen'))
    await openChat(P('Esha'))
    await chat(P('Chen'), `"${cluesA1[0]}" has to be ${wordsA[codeA1[0]! - 1]}. ${codeA1[0]}!`, 45)
    await sleep(600)
    await chat(P('Esha'), `Yes! And "${cluesA1[1]}" is ${codeA1[1]}, ${wordsA[codeA1[1]! - 1]}`, 0)
  })
  film.bubble('Asha', 'Poker face. Saying nothing!', 2600)
  await chat(P('Esha'), `"${cluesA1[2]}" is ${codeA1[2]}. So ${codeA1.join('-')}`, 0)
  await sleep(2200)
  await closeChat(P('Esha'))
  await sleep(500)
  await closeChat(P('Chen'))
  await film.sayWhile(N.stat, () => show(P('Chen'), P('Chen').getByRole('radio', { name: 'Clue 1 is 1' }), 'start'))
  await film.sayWhile(N.pick, () => pickCode(P('Chen'), codeA1, 900, false))
  await lockIn(P('Chen'), 500)
  await waitPhase(film, 'reveal')
  film.caption('The reveal')
  await film.sayWhile(N.reveal1, () => show(P('Chen'), P('Chen').getByTestId('stamp')))
  await nextIfReveal(film)

  // ---------------- round 1: Ben on air
  await waitPhase(film, 'transmit')
  film.caption('Ben’s turn')
  film.spotlight('Ben')
  await film.sayWhile(N.ben, () => readAloud(film, 'Ben', cluesB1[0]!, 0))
  await readAloud(film, 'Ben', cluesB1[1]!, 1)
  await readAloud(film, 'Ben', cluesB1[2]!, 2)
  await waitPhase(film, 'guess')
  film.spotlight('Esha')
  await film.sayWhile(N.benDecode, async () => {
    await chat(P('Farhan'), `${codeB1.join('-')} easy`, 0)
    await sleep(1500)
    await closeChat(P('Farhan'))
    await sleep(1500)
    await pickCode(P('Dev'), codeB1, 300, false)
  })
  await lockIn(P('Dev'))
  await waitPhase(film, 'reveal')
  await film.sayWhile(N.reveal2, () => show(P('Esha'), P('Esha').getByRole('tablist'), 'start'))
  await nextIfReveal(film)

  // ---------------- round 2: clues
  await waitPhase(film, 'encrypt')
  for (const n of NAMES) expect(await P(n).getByTestId('my-code').count(), `${n} encryptor in round 2?`).toBe(n === 'Chen' || n === 'Dev' ? 1 : 0)
  const codeA2 = await codeOf(P('Chen'))
  const codeB2 = await codeOf(P('Dev'))
  const cluesA2 = cluesFor(codeA2, wordsA, 2, cluesA1)
  const cluesB2 = cluesFor(codeB2, wordsB, 2, cluesB1)
  film.caption('Round 2 · Interception')
  film.spotlight('Dev')
  await film.sayWhile(N.round2, async () => { await sleep(3500); await show(P('Dev'), P('Dev').getByTestId('clue-0')) })
  film.spotlight(null)
  await film.cut(async () => {
    await typeClues(P('Dev'), cluesB2)
    await typeClues(P('Chen'), cluesA2)
    await sendClues(P('Dev'))
    await sendClues(P('Chen'))
    await waitPhase(film, 'transmit')
    await sleep(4500) // let the sand-timer toast fade
  }, 'clues written')

  // ---------------- round 2: Dev on air
  film.spotlight('Dev')
  await film.sayWhile(N.devAir, () => readAloud(film, 'Dev', cluesB2[0]!, 0))
  await readAloud(film, 'Dev', cluesB2[1]!, 1)
  await readAloud(film, 'Dev', cluesB2[2]!, 2)
  await waitPhase(film, 'guess')

  // ---------------- round 2: the interception
  film.caption('Their intel')
  film.spotlight('Esha')
  await expect(P('Esha').getByRole('heading', { name: 'Intercept their code!' })).toBeVisible()
  await film.sayWhile(N.intel, async () => {
    await P('Esha').evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
    // Ben's team decodes their own code meanwhile, off to the side.
    const t = Date.now()
    await pickCode(P('Farhan'), codeB2)
    console.log(`[demo] Farhan pick took ${Date.now() - t}ms`)
  })
  const reasoning = codeB2.map((d, i) => {
    const k = codeB1.indexOf(d)
    return k >= 0 ? `"${cluesB2[i]}" goes with "${cluesB1[k]}". That's ${d}!` : `"${cluesB2[i]}" is new. So ${d}, the one with no clues yet`
  })
  await film.sayWhile(N.plot, async () => {
    const t = Date.now()
    await openChat(P('Esha'))
    await chat(P('Asha'), reasoning[0]!, 0)
    await sleep(1500)
    await chat(P('Chen'), reasoning[1]!, 0)
    await sleep(1500)
    await chat(P('Asha'), reasoning[2]!, 0)
    console.log(`[demo] plot chat took ${Date.now() - t}ms`)
  })
  await chat(P('Esha'), `So ${codeB2.join('-')}. Locking it in!`, 30)
  await sleep(600)
  await film.sayWhile(N.tapRule, async () => {
    await closeChat(P('Asha'))
    await closeChat(P('Chen'))
    await closeChat(P('Esha'))
    await pickCode(P('Esha'), codeB2, 700, false)
  })
  await lockIn(P('Esha'), 500)
  await waitPhase(film, 'reveal')
  film.caption('Wiretapped!')
  await film.sayWhile(N.wiretapped, async () => {
    await show(P('Esha'), P('Esha').getByTestId('stamp'))
    await sleep(3000)
    film.bubble('Dev', 'Arre yaar! How?!', 2400)
    await sleep(1200)
    film.bubble('Esha', 'We were listening!', 2000)
  })
  film.spotlight(null)

  // ---------------- skip to the end
  await film.cut(async () => {
    await nextIfReveal(film)
    await quickTransmission(film, 'Chen', cluesA2, codeA2, ['Asha'], ['Ben'], false)
    // round 3
    await waitPhase(film, 'encrypt')
    const codeA3 = await codeOf(P('Esha'))
    const codeB3 = await codeOf(P('Farhan'))
    const cluesA3 = cluesFor(codeA3, wordsA, 3, [...cluesA1, ...cluesA2])
    const cluesB3 = cluesFor(codeB3, wordsB, 3, [...cluesB1, ...cluesB2])
    await typeClues(P('Esha'), cluesA3)
    await typeClues(P('Farhan'), cluesB3)
    await sendClues(P('Esha'))
    await sendClues(P('Farhan'))
    await quickTransmission(film, 'Esha', cluesA3, codeA3, ['Asha'], ['Ben'], false)
    await quickTransmission(film, 'Farhan', cluesB3, codeB3, ['Ben'], ['Asha'], true)
    for (const n of NAMES) await expect(P(n).getByTestId('results')).toBeVisible({ timeout: 30_000 })
    await sleep(2500)
  }, 'one round later')

  // ---------------- results
  film.caption('Game over')
  film.spotlight('Asha')
  await expect(P('Asha').getByTestId('results')).toContainText(/wiretapped two codes/)
  await P('Asha').evaluate(() => window.scrollTo({ top: 0 }))
  await film.say(N.results)
  await film.sayWhile(N.outro, async () => {
    await sleep(2000)
    await show(P('Asha'), P('Asha').getByRole('heading', { name: /Highlights/ }), 'start')
  })
  await film.pause(1200)
  await film.finish()
})
