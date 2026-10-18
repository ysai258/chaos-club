import { expect, test, type Page } from '@playwright/test'
import { setUpLobby, start, startFilm, tap, tts, type Film } from '../kit.ts'

/**
 * Pitch Wars how-to-play. Products and twists are random, so the poster copy
 * comes from a joke table keyed by product title: [startup name, slogan, the
 * pitcher's opening line].
 */
const JOKES: Record<string, [string, string, string]> = {
  'Mosquito-Powered AC': ['BuzzCool', 'They bite you. Now they cool you.', 'Sharks, every night mosquitoes take your blood. What if they gave something back?'],
  'Smart Chappal': ['ChappalGPT', 'Steps tracked. Kids corrected.', 'Mummy\'s chappal has been aimed by hand for 5,000 years. Not anymore.'],
  'Pressure Cooker Whistle Counter': ['WhistleBlower', 'Was that three or four? Never again.', 'Every Indian kitchen has one question: was that the third whistle?'],
  'Self-Stirring Chai Glass': ['StirFry Chai', 'The spoon is dead. Long live the spill.', 'Sharks, who has time to stir chai in this economy?'],
  'Power-Cut Predictor': ['BijliBaba', 'Half right. Every single time.', 'The power will go. The only question is when. We answer it. Sometimes.'],
  'Remote Control Finder Remote': ['RemoteCeption', 'A remote for your remote for your remote.', 'The remote is lost again. It is always lost. We fixed that. Twice.'],
  'Inverter for Your Inverter': ['DoubleBackup', 'Because one backup is just a front-up.', 'What happens when the inverter dies? Panic. Unless you have ours.'],
  'Noise-Cancelling Dupatta': ['ShushWrap', 'Relatives at 40%. Peace at 100%.', 'Sharks, picture a family function. Now picture it on mute.'],
  'Solar-Powered Torch': ['SunTorch', 'Bright when you need it least.', 'Why waste darkness on darkness? Our torch shines in broad daylight.'],
  'Geyser Countdown Clock': ['ShampooPanic', 'Know before the cold water hits.', 'We have all been there: shampoo in the hair, ice water on the head.'],
  'Bluetooth Steel Tumbler': ['TumblrTooth', 'Your filter coffee, now with notifications.', 'Your coffee goes cold while you scroll. Now your coffee scrolls back.'],
  'Ceiling Fan Selfie Stick': ['FanCam 360', 'Selfies with a spin.', 'Group photos never fit everyone. Our fan fits everyone. Very fast.'],
  'Doorbell That Says "Coming!"': ['AaRahaHoon', 'Ten minutes of "Coming!" on autopilot.', 'Doorbell rings mid-episode. You shout coming. Our bell shouts it for you.'],
  'Wi-Fi Booster Tulsi Plant': ['TulsiNet', 'Holy basil. Holy bandwidth.', 'Your Wi-Fi is weak. Your tulsi is strong. We combined them.'],
  'Lift Button Pusher Pro': ['PressPress', 'Press it ten times. Feel in control.', 'Science says pressing the lift button twice does nothing. We press it fifty times.'],
  "Uber for Aunties' Gossip": ['GossipGo', 'Hot gossip in 15 minutes or it is free.', 'Why wait for the kitty party when gossip can come to your door?'],
  'Uber for Queue Standing': ['LineWala', 'You relax. We wait.', 'Indians spend ten years of life in queues. We rent you those ten years back.'],
  'Uber for Borrowed Sugar': ['KatoriKart', 'One katori of sugar, zero awkwardness.', 'Sharks, borrowing sugar from neighbours is a dying art. We are reviving it.'],
  'Uber for Fake Relatives': ['RentAChacha', 'Nods at weddings. Never asks your salary.', 'Every wedding has that uncle who asks your salary. Replace him with ours.'],
  'Uber for Bargaining': ['MolBhavPro', 'Why pay full price like an amateur?', 'Tomatoes at eighty rupees? Not on our watch. Our haggler gets them for forty.'],
  'Uber for Apology Calls': ['SorryMaa', 'Your guilt, professionally handled.', 'You forgot to call your mother. Again. Do not worry, we already called.'],
  'Uber for Parking Spots': ['ChairPeChair', 'One plastic chair. Infinite parking.', 'Finding parking in India is harder than JEE. We hold your spot with a chair.'],
  'Uber for Excuses': ['BahanaBazaar', 'Skip plans. Guilt-free. Verified.', 'Sharks, saying no is hard. Saying "my cousin is unwell" is easy.'],
  'Uber for Plus-Ones': ['ShaadiBuddy', 'The plus-one that silences the aunties.', 'Going to a wedding single is a sport. Our plus-one makes you win it.'],
  'Uber for Cheering': ['TaaliKart', 'Finish a task. Get a standing ovation.', 'You did the dishes. Nobody clapped. That ends today.'],
  'Uber for Group Project Work': ['OneWhoWorks', 'Finally, someone in the group does the work.', 'Every group project has five names and one worker. We rent you the worker.'],
  'Uber for Waking You Up': ['UthJaa', 'Snooze is not an option anymore.', 'Alarms can be snoozed. A stranger at your door cannot.'],
  'Blockchain Tiffin Box': ['ParathaChain', 'Your lunch, on the ledger.', 'Your colleague stole your paratha. With us, that paratha is now an immutable token.'],
  'Sleep-Learning Pillow': ['NeendPadhai', 'Sleep eight hours. Learn zero chapters.', 'Why study awake when you can be confused in your sleep?'],
  'JEE Prep for Toddlers': ['IIT Junior', 'Crack JEE before you crack walking.', 'Sharks, the competition starts at birth. Our customers start at age two.'],
  'AI Tuition Uncle': ['MarksKitne.ai', 'First your marks. Then your cousin\'s.', 'Kids miss the pressure of a real tuition uncle. We automated the comparison.'],
  'Excuse Writing Masterclass': ['DogAteItAcademy', 'Turning late submissions into an art.', 'The assignment was due yesterday. Our students have a 100 percent excuse rate.'],
  'Rote Learning Rap Course': ['RattaRap', 'Drop the beat. Memorise the date.', 'History is boring. History with a beat drop? Panipat, yo.'],
  'Viva Panic Simulator': ['SweatVR', 'Four minutes of silence. Real fear.', 'Nothing prepares you for a viva. Except staring at our silent examiner.'],
  'Coding Bootcamp for Grandpas': ['DadaDev', 'From good morning forwards to full stack.', 'Your grandpa already forwards fifty messages a day. He is basically a backend.'],
  'Back-Bencher Certification': ['LastBench Labs', 'Sleep with your eyes open. Graduate with honours.', 'Back-benchers have skills nobody certifies. Until today.'],
  'Handwriting Improvement NFT': ['ScribbleCoin', 'Your bad handwriting, now a rare asset.', 'Doctors write like this and they earn crores. Why not you?'],
  'Biodata-as-a-Service': ['RishtaReady', 'So good even you would marry you.', 'Your biodata says "fair, homely, likes cricket". We can do better.'],
  'Swipe Right for Mummy': ['MummySwipe', 'She swipes. You show up.', 'Mothers are choosing your partner anyway. We just gave them an app.'],
  'Kundli Matching for Pets': ['PawKundli', 'Thirty-six gunas. Four paws.', 'Your dog and the neighbour\'s cat keep fighting. Maybe their stars do not match.'],
  'Rishta Radar': ['AuntyAlert', 'Proposal incoming. Run.', 'An aunty with a proposal is two kilometres away and approaching fast.'],
  'Dating App for Introverts': ['NoReply', 'Match. Never text. Perfect.', 'Introverts want love, but without talking. We delivered exactly that.'],
  'LinkedIn for Rishtas': ['RishtaIn', 'Endorsed for round rotis.', 'Your cousin has five endorsements for chai-making. That is a career.'],
  'Arranged Marriage Speedrun': ['ShaadiSpeedrun', 'Chai to hall booking in 90 minutes.', 'Arranged marriages take months. Our record is one cup of chai.'],
  'Breakup Delivery Service': ['ByeBake', 'Bad news, with a good cake.', 'Breaking up is hard. Unless it comes with a black forest cake.'],
  'Wedding Card Spam Filter': ['WillTryToCome', 'RSVP: will try. Every time.', 'You get forty wedding cards a season. We reply to all of them. Vaguely.'],
  'Chai Subscription Drone': ['ChaiCopter', 'Every 47 minutes. No escape.', 'Sharks, India runs on chai. Our drones make sure it never stops.'],
  'Gluten-Free Air': ['PureHawa', 'Breathe premium. Breathe gluten-free.', 'Normal air is so common. Ours comes in a bottle with a certificate.'],
  'Maggi Timer That Lies': ['TwoMinute Truth', 'Two minutes. Emotionally.', 'Maggi has lied to us for decades. We made the lie official.'],
  'Samosa Wrapped in Samosa': ['SamosaSquared', 'One layer is for the weak.', 'Why stop at one crust when you can have two?'],
  'Leftover Dal NFT Market': ['DalVault', 'Yesterday\'s dal, tomorrow\'s asset.', 'Mom is about to turn your dal into paratha. Mint it before she does.'],
  'Artisanal Ice Cubes': ['HimalayaRocks', 'Hand-frozen. Heart-melting price.', 'Your fridge ice is mass-produced. Ours was frozen by a man with a beard.'],
  'Pani Puri Vending Machine': ['PuriBot', 'One puri. One judgement.', 'The pani puri bhaiya always gives your friend more. Our machine is fair. And rude.'],
  'Spice Level Insurance': ['TeekhaCover', 'Medium spicy? We cover the milk.', 'The waiter said medium. Your tongue said otherwise. Now you are insured.'],
  'Keto Jalebi': ['JalebiZero', 'All the shape. None of the joy.', 'Sharks, you want jalebi but your doctor says no. Now you can have the shape.'],
  'Chai Sommelier App': ['ChaiSniff', 'Fourteen notes. One verdict: beta, boiled too long.', 'Wine has sommeliers. Chai has us.'],
  'Reusable Tea Bag Club': ['OneBagSociety', 'One tea bag. Forty flats.', 'Sustainability starts with sharing. Specifically, one tea bag.'],
  'Ghee Cloud Storage': ['GheeDrive', 'Your ghee, in the cloud.', 'Your ghee is not safe at home. Your relatives know where it is.'],
  'Jugaad-as-a-Service': ['JugaadHub', 'Fixed with a rubber band. Guaranteed.', 'Why repair it properly when a rubber band will do?'],
  'Bucket Washing Machine': ['BaltiWash', 'One bucket. One stick. Zero electricity bill.', 'Washing machines are expensive. A bucket with a button sticker is not.'],
  'Brick-Powered Phone Stand': ['BrickStand', 'Half a brick. Full premium.', 'Every Indian home already uses a brick for something. Now it holds your phone.'],
  'Cooler-in-a-Matka': ['MatkaCool', 'Rustic air. Modern fan.', 'Summer is coming. Your AC bill is coming faster. Meet the matka.'],
  'Charger Wire Life Support': ['TapeTech', 'One more year. One more roll of tape.', 'Your charger wire is dying. We are its ventilator.'],
  'Universal Lid Finder': ['DhakkanAI', 'Every lid. Wrong dabba. With AI.', 'There are a million dabbas in your kitchen and zero matching lids.'],
  'Hanger Antenna 5G': ['Hanger5G', 'Bend it. Believe it.', 'Your signal is weak. Your coat hanger is strong. Coincidence? No.'],
  'Premium Rubber Band Co.': ['BandBaaja', 'Doorknob luxury, in a velvet box.', 'Every doorknob in India wears a rubber band. Ours wear couture.'],
  'Organic Free-Range Bricks': ['HappyBricks', 'Raised free. Built strong.', 'Factory bricks never see sunlight. Ours grew up in open fields.'],
  'Plastic Bag Inside Plastic Bag': ['BagOfBags', 'Curated chaos, under your sink.', 'Every home has a bag full of bags. We put a brand on it.'],
  'Vibe-Based Toothpaste': ['MoodPaste', 'Brush with feelings.', 'Mint is so 1990. Our toothpaste tastes like your emotions.'],
  'Luxury Steel Dabbas': ['DabbaDiaries', 'Engraved. Unstealable.', 'Your dabba went to a party and never came back. Never again.'],
  'Desi Scented Candles': ['TadkaGlow', 'Light it up. Smell the tadka.', 'Why smell like lavender when you can smell like dal tadka?'],
  'Sustainable Newspaper Plates': ['NewsChaat', 'Read the headlines. Eat the chaat.', 'Yesterday\'s news is useless. Unless you put chaat on it.'],
  'Handmade Mosquito Coils': ['ChandanCoil', 'Smells divine. Does nothing.', 'Mosquitoes never left. But now your room smells like a temple.'],
  'Overthinking Retreat': ['ReplayRetreat', 'Three days with your most awkward memories.', 'You already overthink for free. We made it a luxury experience.'],
  'Laughter Yoga for Meetings': ['HaHaStandup', 'Laugh now. Cry at appraisal.', 'Meetings are sad. Forced laughter is less sad. Science.'],
  'Nap Pods for Traffic': ['SignalSnooze', 'Red light. Deep sleep.', 'You spend two hours a day at red lights. Why not sleep through them?'],
  'Digital Detox Phone': ['TreePhone', 'Just a tree. For one lakh.', 'Screen time is killing us. Our phone shows one tree. Forever.'],
  'Gratitude Journal for Cynics': ['MehDiary', 'Name one thing that was less bad today.', 'Positive thinking is not for everyone. We have journals for the rest of us.'],
  'Monsoon Mood Lamp': ['BaarishBulb', 'Rain, thunder and pakodas on demand.', 'Monsoon lasts three months. Our lamp makes it last forever.'],
  'Sunday Scaries Shield': ['MondayMute', 'Monday cannot find you here.', 'Sunday evening, 6 pm. The dread begins. Unless you have our blanket.'],
  'Burnout Spa for Freelancers': ['ChangesSpa', 'Relax. One small change.', 'Freelancers never rest. So we bring the client to the massage.'],
  'Buy Now, Pay Never': ['PayKabhiNahi', 'Powered by optimism.', 'Why pay later when you could just never pay?'],
  'Crypto for Kirana Stores': ['KiranaCoin', 'Eggs on the blockchain.', 'The kirana uncle already gives credit on trust. We just added crypto to it.'],
  'Shagun Envelope Tracker': ['Shagun Ledger', 'Rs 101 in, Rs 101 out.', 'Who gave you 101 at your wedding? Who gave 51? You need to know.'],
  'Split-the-Bill Arbitrator': ['NaanJudge', 'Who ate the extra naan? The AI knows.', 'Every friend group has one person who ate four naans and paid for one.'],
  'Piggy Bank With EMI': ['GullakEMI', 'Break it in 12 easy instalments.', 'Breaking a piggy bank is traumatic. Now it is spread over a year.'],
  'Change Instead of Toffee': ['ToffeeSIP', 'Every toffee, invested.', 'Shopkeepers give you toffee instead of change. We turn that toffee into wealth.'],
  'Loan for Your Loan': ['LoanCeption', 'EMI for your EMI.', 'Cannot pay your EMI? Simple. Take another one.'],
  'Friend Who Owes You Tracker': ['PaiseDe', 'Polite reminder. Then a rude one.', 'Your friend borrowed 500 in 2019. He thinks you forgot. We did not.'],
  'Fitbit for Street Dogs': ['MotiMeter', 'Every bike chased, counted.', 'Street dogs run marathons daily, chasing bikes. Nobody tracks their cardio.'],
  'Cat Mood Translator': ['MeowMeans', 'Spoiler: they do not respect you.', 'Your cat is saying something. We translated it. You will not like it.'],
  'Doggy Daycare Metaverse': ['BarkVerse', 'Virtual playdates for real dogs.', 'You are in meetings all day. Why should your dog be bored?'],
  'Parrot Tutor App': ['TotaTutor', 'Polite parrots for impolite relatives.', 'Your parrot learned a bad word from your dad. Relatives arrive at six.'],
  'Pet Horoscope Newsletter': ['PawStars', 'Your goldfish is a Scorpio.', 'Your pet\'s behaviour has an explanation. It is in the stars.'],
  'LinkedIn for Pets': ['PetLinked', 'Open to work. Open to treats.', 'Your dog has skills: guarding, barking, loving. Why is he not on LinkedIn?'],
  'Fake Typing Sound Machine': ['TypeTypeType', 'Sound busy. Be relaxed.', 'Your boss can hear silence on calls. Silence is dangerous.'],
  'Reply-All Shock Collar': ['ZapAll', 'One zap per reply-all.', 'Someone hit reply-all again. Two hundred people suffered. Justice is here.'],
  'Meeting-That-Could-Be-Email': ['ShouldaBeenEmail', 'One meeting. One useful line.', 'Ninety percent of meetings could be an email. We send you the email.'],
  'Appraisal Excuse Generator': ['ThreePercent.ai', 'Fifty reasons. One small hike.', 'Managers struggle to explain the three percent hike. Not anymore.'],
  'Standup Desk That Sits Down': ['SlumpDesk', 'Rises at nine. Gives up at three.', 'Your desk should understand you. Ours gets tired exactly when you do.'],
  'Out-of-Office Bot Uncle': ['RevertJi', 'Will check and revert, ji.', 'Nobody actually reads email. Our bot replies like it did.'],
  'Camera-Off Avatar': ['NodBot', 'Always attentive. Never actually there.', 'You turned off your camera. Your boss noticed. Our avatar nods for you.'],
  'Monday Postponement Service': ['MondayLater', 'Monday is now Tuesday.', 'Mondays are the enemy. We simply moved them.'],
  'Wedding Buffet GPS': ['PaneerFinder', 'Beat the uncles to the paneer.', 'At every wedding, the paneer runs out first. Not for our customers.'],
  'Baraat Dance Tutor Drone': ['NaagDrone', 'Hands up! Hands up! Hands up!', 'Nobody dances at the baraat until forced. We force them. From the sky.'],
  'Sangeet Choreography Bot': ['SangeetSync', 'A perfect routine. Uncles will freestyle anyway.', 'Sangeet practice takes three weeks. Our bot takes three seconds.'],
  'Diwali Cleaning Robot': ['SafaiSaathi', 'Finds everything. Questions everything.', 'Diwali cleaning is coming. You will find a 2011 bill. Our robot will judge you.'],
  'Gift Re-Wrapping Service': ['RegiftRight', 'Untraceable re-gifting since today.', 'You have seven unopened dinner sets. Your relatives have seven weddings.'],
  'Wedding Photographer for Food': ['ButterChickenShots', 'The real star of the wedding.', 'Wedding albums are full of people. Where is the biryani?'],
  'Holi Colour Remover Subscription': ['RangOut', 'Scrubbing until June.', 'Holi is one day. The green face lasts for months.'],
  'Relative Name Reminder Glasses': ['KaunHai Specs', 'Know every bua\'s husband\'s brother.', 'At weddings, you touch the feet of strangers. Who are these people?'],
  'Gully Cricket VAR': ['GullyReview', 'Out is finally out.', 'For forty years, gully cricket has argued about one thing: was it out?'],
  'Window Glass Insurance': ['SixCover', 'Hit the six. We pay the glass.', 'Every great six ends with a broken window and a running batsman.'],
  'Fantasy League for Uncles': ['Uncle XI', 'Pick eleven uncles. Win on opinions.', 'Uncles give expert opinions all day. Finally, they earn you points.'],
  'Rain-Delay Entertainment Kit': ['DrizzleBox', 'Eight hours of drizzle, sorted.', 'Rain stops play. Boredom starts play. Unless you have our kit.'],
  'Ball-Lost-in-Bush Tracker': ['BushBall', 'The innings never ends again.', 'The tennis ball went into the bush. The match ended. That stops today.'],
  'Commentary for Your Life': ['LifeCommentary', 'Every chore, a last-over chase.', 'Brushing your teeth is boring. Unless a commentator is screaming about it.'],
  'Slow-Mo Hair Fan': ['HeroEntry', 'Every entry, a blockbuster.', 'Heroes always have wind in their hair. Now you do too.'],
  'Dramatic Background Score App': ['DhishoomTune', 'Every decision, a dhol hit.', 'Ordering paneer or dal? That decision deserves a soundtrack.'],
  'Rain Song Generator': ['BarsaatBeats', 'Feel feelings. Get drizzle.', 'Sad? It should be raining. With a song. We handle both.'],
  'Villain Laugh Coach': ['MuahahaClass', 'Your evil laugh, perfected.', 'Every great villain has one thing: a laugh that echoes. Do you?'],
  'Train Running Romance Kit': ['PlatformPyaar', 'Reach for the hand. Catch the train.', 'Every love story needs a moving train. We bring the train.'],
  'Item Song Ringtone Club': ['RingRingMasti', 'Loudest ringtone. Worst timing.', 'Your ringtone is boring. During meetings, it will not be.'],
  'Pothole Dating App': ['GaddhaMatch', 'Swipe right on a road crew.', 'Potholes are lonely. Road crews are lonely. We bring them together. Almost.'],
  'Honk Translator': ['PeepPeepAI', 'Every honk, translated. Mostly rude.', 'India speaks one language on the road: honk. Now you can understand it.'],
  'Inflatable Monsoon Scooter': ['ScootBoat', 'Road today. River tomorrow.', 'In July, every road becomes a river. Your scooter should become a boat.'],
  'Traffic Signal Snack Bar': ['RedLightPakoda', 'Stuck? Snack.', 'You wait 180 seconds at every signal. That is a pakoda break.'],
  'Waterlogging Weather App': ['KneeCast', 'Today: two knees.', 'Weather apps say millimetres. We say knees.'],
  'Auto Fare Negotiator Bot': ['MeterSeChalo', 'Haggled before you arrive.', 'Bhaiya, meter se chalo? He says no. Our bot says yes for him.'],
  'Umbrella That Stays Home': ['StayBrella', 'Forgotten. On purpose.', 'You always forget your umbrella. Ours is designed to be forgotten.'],
  'PG Food Rating Agency': ['DalScore', 'From water to slightly yellow water.', 'PG dal comes in many shades of water. Finally, someone rates them.'],
  'Roommate Snoring Bouncer': ['SnoreBounce', 'Snore. Bounce. Repeat.', 'Your roommate snores like a tractor. Our pillow fights back.'],
  'Midnight Maggi Hotline': ['2AM Maggi', 'Noodles and life advice, at 2 am.', 'It is 2 am. You are hungry and confused. One call fixes both.'],
  'Warden Detection Radar': ['WardenWatch', 'Beep. Hide. Survive.', 'The warden is thirty metres away. You have no idea. Until now.'],
  'Shared Shampoo Blockchain': ['ShampooChain', 'Proof of who used your shampoo.', 'Your shampoo is disappearing. The blockchain knows who did it.'],
  'Laundry Lottery': ['KapdaLotto', 'Drop your clothes. Win someone else\'s.', 'Why wear the same clothes when you could wear random ones?'],
  'Sharma-ji Comparison Blocker': ['SharmaBlock', 'No more neighbour\'s son.', 'Sharma-ji\'s son is a doctor. You have heard it a million times. Never again.'],
  'Parental Forward Fact-Checker': ['PapaFactCheck', 'Onions do not cure everything, Papa.', 'Your dad believes every forward. We gently disagree with him.'],
  'Relative Visit Early Warning': ['MehmaanAlert', 'Two hours to hide the snacks.', 'Relatives are coming. Surprise! Not anymore.'],
  '"When Is Marriage?" Deflector': ['TopicChanger', 'Marriage? Have you seen property rates?', 'Every family function has one question: beta, shaadi kab? We deflect it.'],
  'Mom’s Missed Call Decoder': ['MissedCallMeaning', 'One ring: call. Three rings: run.', 'Mom gave you a missed call. What does it mean? Our AI knows.'],
  'Dad Joke Licensing Office': ['PunControl', 'Fourth time? License, please.', 'Your dad has told that joke forty times. It is time for regulation.'],
  'Grandma Tech Support Line': ['NaniHelpdesk', 'Explaining WhatsApp. For the 30th time.', 'Nani forgot how to send a photo again. Our patience is unlimited.'],
  'Fridge Lock for Guest Sweets': ['MithaiLock', 'Only for guests. Not for you.', 'The good mithai is for guests. Your kids know where it is. Not anymore.'],
}

const ANSWERS = [
  'Excellent question! I will answer it in full... right after you sign the cheque.',
  'Honestly? My mummy already invested. That should tell you everything.',
]

const N = {
  intro: 'Welcome to Pitch Wars! Two teams sell terrible startups, live on the Meet call, to their friends. For crores.',
  lobby: 'Six friends, two teams of three, one round. The host taps start!',
  cards: 'Each team secretly draws a terrible product, and a twist card they MUST use. The other team cannot see any of it.',
  chat: 'The rivals can hear everything on the call, so teams plot in private team chat. Ideas fly in.',
  poster: 'Then they build the poster: a startup name, a slogan, and a price.',
  mascot: 'Pick a mascot. A unicorn, obviously.',
  ask: 'Now the Ask: how many crores you want. Beat it, and it is a DEAL, plus a bonus. Miss it, and you only get half.',
  preview: 'Here is the live poster. Only your own team sees it, until you pitch. Then tap ready.',
  stage: 'Showtime! The pitcher unmutes on Meet, and the other team turns into the Sharks.',
  teleprompter: 'The pitcher\'s phone becomes a teleprompter: the poster, the twist, and every question fired at them.',
  sharks: 'The Sharks get a hand of nasty question cards. Tap one, and it lands on the pitcher\'s screen.',
  answer: 'And the pitcher has to answer it, out loud, right now.',
  curveball: 'Once a round, the Sharks can throw a curveball. The pitcher must deal with it live, and gets 15 extra seconds.',
  done: 'When the pitch is over, the pitcher taps done.',
  cheque: 'Now every Shark secretly signs a cheque. Nobody sees the amounts, not even their own teammates.',
  reveal: 'The cheques flip one by one. The Sharks\' average has to beat the Ask.',
  deal: 'DEAL! They beat the Ask, so they bank the money, plus half the Ask as a bonus.',
  swap: 'Then the teams swap. The Sharks become the pitchers, with their own startup.',
  greedy: 'This team got greedy, and asked for ten crore.',
  nodeal: 'NO DEAL. They missed the Ask, so the Sharks only half-fund them.',
  results: 'Most crores wins! Play a few rounds, so everyone gets a turn as the lead pitcher.',
  outro: 'So grab your friends, hop on a call, and start selling terrible startups!',
}

/** The cast: Yash hosts and leads team 1. Join order alternates teams. */
const P = { host: 'Yash', t1b: 'Manu', t1c: 'Srinivas', t2a: 'Charan', t2b: 'Aravind', t2c: 'Joga' } as const
const NAMES = [P.host, P.t2a, P.t1b, P.t2b, P.t1c, P.t2c]
const TEAMS = [[P.host, P.t1b, P.t1c], [P.t2a, P.t2b, P.t2c]]

function jokesFor(product: string): [string, string, string] {
  const j = JOKES[product]
  if (j) return j
  const word = product.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean)
  return [`${word[0] ?? 'Startup'}ly`, 'Nobody asked. We built it anyway.', `Sharks, nobody knew they needed ${product}. Until today.`]
}

/** Click only if it is still there (phases can move on by themselves). */
async function tapIfThere(page: Page, testId: string): Promise<void> {
  const el = page.getByTestId(testId)
  if (await el.isVisible().catch(() => false)) await tap(el).catch(() => {})
}

async function typeSlowly(page: Page, testId: string, text: string, delay = 55): Promise<void> {
  const input = page.getByTestId(testId)
  await tap(input)
  await input.pressSequentially(text, { delay })
  await input.blur()
}

async function scrollTo(page: Page, testId: string, block: ScrollLogicalPosition = 'center'): Promise<void> {
  await page.getByTestId(testId).first().evaluate((el, b) => el.scrollIntoView({ block: b, behavior: 'smooth' }), block)
}

async function scrollTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
}

async function sendChat(page: Page, text: string): Promise<void> {
  await tap(page.getByTestId('team-chat-button'))
  const box = page.getByLabel('Team chat message')
  await box.pressSequentially(text, { delay: 45 })
  await box.press('Enter')
  await expect(page.getByTestId('team-chat-list')).toContainText(text.slice(0, 12))
}

async function closeChat(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
}

/** The pitcher of each team, read off the prep screen. */
async function pitcherOf(film: Film, team: string[]): Promise<string> {
  const line = (await film.page(team[0]!).getByTestId('pw-pitcher-line').textContent()) ?? ''
  if (line.includes('YOU')) return team[0]!
  return team.find((n) => line.includes(n)) ?? team[0]!
}

test('pitch-wars', async ({ browser }) => {
  const film = await startFilm(browser, { game: 'pitch-wars', names: NAMES, teams: TEAMS, lines: [...Object.values(N), ...ANSWERS] })
  const host = film.room.host

  // ---------------------------------------------------------------- lobby
  film.caption('Setting up')
  film.focus(P.host)
  await film.sayWhile(N.intro, () => setUpLobby(film, { game: 'pitch-wars', teams: TEAMS, settings: { rounds: 1 } }))
  const teamName0 = ((await host.getByTestId('team-0').getByTestId('team-name').textContent()) ?? '').trim()
  await film.sayWhile(N.lobby, async () => {
    await host.waitForTimeout(2500)
    await start(film)
  })
  for (const n of NAMES) await scrollTop(film.page(n))
  for (const n of NAMES) await expect(film.page(n).getByTestId('pw-prep')).toBeVisible()

  // Who pitches first? The round header lists teams in pitching order.
  const firstTitle = await host.getByTestId('pw-prep').locator('span[title]').first().getAttribute('title')
  const aIdx = firstTitle?.trim() === teamName0 ? 0 : 1
  const A = TEAMS[aIdx]!
  const B = TEAMS[1 - aIdx]!
  const pA = await pitcherOf(film, A)
  const pB = await pitcherOf(film, B)
  const [mateA1, mateA2] = A.filter((n) => n !== pA) as [string, string]
  const sharksA = B // the sharks during A's pitch
  const productA = ((await film.page(pA).getByTestId('pw-product').textContent()) ?? '').trim()
  const twistA = ((await film.page(pA).getByTestId('pw-twist').textContent()) ?? '').trim()
  const productB = ((await film.page(pB).getByTestId('pw-product').textContent()) ?? '').trim()
  const [nameA, sloganA, hookA] = jokesFor(productA)
  const [nameB, sloganB, hookB] = jokesFor(productB)
  const drewLine = `${pA} pitches first, so ${pA}'s team got: ${productA}. And the twist: ${twistA}.`
  const drew = tts(drewLine) // synthesised in the background while the next line plays

  // ---------------------------------------------------------------- prep
  film.caption('Prep · in secret')
  film.focus(null) // rings would be drawn across the spotlight
  film.spotlight(pA)
  await film.say(N.cards)
  await drew
  await film.say(drewLine)

  // Team chat ideas from the teammates.
  film.spotlight(mateA1)
  await film.sayWhile(N.chat, async () => {
    await sendChat(film.page(mateA1), `Call it ${nameA}!`)
    await sendChat(film.page(mateA2), `Slogan: ${sloganA}`)
    await film.page(mateA1).waitForTimeout(400)
  })
  await film.pause(1200)
  await closeChat(film.page(mateA1))
  await closeChat(film.page(mateA2))

  // The pitcher builds the poster.
  const pa = film.page(pA)
  film.spotlight(pA)
  await film.sayWhile(N.poster, async () => {
    await typeSlowly(pa, 'pw-name', nameA)
    await typeSlowly(pa, 'pw-slogan', sloganA, 35)
    await tap(pa.getByRole('button', { name: 'Free* (*T&C)' }))
  })
  await film.sayWhile(N.mascot, async () => {
    await tap(pa.getByRole('radio', { name: '🦄', exact: true }))
  })
  await film.sayWhile(N.ask, async () => {
    await pa.getByRole('radio', { name: '₹3 cr', exact: true }).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    await pa.waitForTimeout(2500)
    await pa.getByRole('radio', { name: '₹3 cr', exact: true }).click()
    await pa.waitForTimeout(800)
    await pa.getByRole('radio', { name: '10%', exact: true }).click()
  })
  await film.sayWhile(N.preview, async () => {
    await scrollTo(pa, 'pw-poster')
    await pa.waitForTimeout(3600)
    await tap(pa.getByTestId('pw-ready'))
  })

  // The other team, off camera.
  await film.cut(async () => {
    const pb = film.page(pB)
    await pb.getByTestId('pw-name').fill(nameB)
    await pb.getByTestId('pw-slogan').fill(sloganB)
    await pb.getByTestId('pw-price').fill('₹9,999 + GST')
    await pb.getByRole('radio', { name: '👑', exact: true }).click()
    await pb.getByRole('radio', { name: '₹10 cr', exact: true }).click()
    await pb.getByRole('radio', { name: '2%', exact: true }).click()
    await pb.getByTestId('pw-name').blur()
    await pb.waitForTimeout(600)
    await tap(pb.getByTestId('pw-ready'))
    await expect(pa.getByTestId('pw-stage')).toBeVisible()
  }, 'both teams ready')

  // ---------------------------------------------------------------- pitch 1
  film.caption(`Pitch 1 · ${pA} on the mic`)
  film.spotlight(pA)
  await film.sayWhile(N.stage, async () => {
    await pa.waitForTimeout(3000)
    await tapIfThere(pa, 'pw-start')
  })
  await expect(pa.getByTestId('pw-pitch')).toBeVisible()
  await film.say(N.teleprompter)
  await film.shout(pA, hookA, 4200)
  await film.shout(pA, `Introducing ${nameA}! ${sloganA}`, 3800)
  await film.shout(pA, `The twist? ${twistA}! That is not a bug, Sharks. That is the business model!`, 4200)

  // Sharks fire a question.
  const [s1, s2, s3] = sharksA as [string, string, string]
  film.spotlight(s1)
  const ps1 = film.page(s1)
  await film.sayWhile(N.sharks, async () => {
    await scrollTo(ps1, 'pw-shark-tools', 'start')
  })
  const q1 = ps1.getByTestId('pw-question').first()
  const q1Text = ((await q1.textContent()) ?? '').replace(/^🎯/u, '').trim()
  await tap(q1)
  await film.shout(s1, q1Text, 3200)
  film.spotlight(pA)
  await expect(pa.getByTestId('pw-fired').first()).toBeVisible()
  await film.say(N.answer)
  await film.shout(pA, ANSWERS[0]!, 3800)

  // Curveball.
  const ps2 = film.page(s2)
  film.spotlight(s2)
  await film.sayWhile(N.curveball, async () => {
    await scrollTo(ps2, 'pw-curveball')
    await ps2.waitForTimeout(2500)
    await tap(ps2.getByTestId('pw-curveball').first())
    await ps2.waitForTimeout(500)
    await scrollTo(ps2, 'pw-throw')
  })
  const cbText = ((await ps2.getByTestId('pw-curveball').first().textContent()) ?? '').trim()
  await tap(ps2.getByTestId('pw-throw'))
  film.spotlight(null) // the CURVEBALL flash hits every phone
  film.focus(s2)
  await film.shout(s2, `Curveball! ${cbText}`, 3200)
  film.focus(null)
  film.spotlight(pA)
  await scrollTop(pa)
  await film.shout(pA, 'Arre, no problem! I eat curveballs for breakfast. With chai.', 3600)

  // A second question from another shark.
  const ps3 = film.page(s3)
  const q2 = ps3.getByTestId('pw-question').nth(1)
  if (await q2.isEnabled().catch(() => false)) {
    const q2Text = ((await q2.textContent()) ?? '').replace(/^🎯/u, '').trim()
    await tap(q2)
    await film.shout(s3, q2Text, 3000)
    await film.shout(pA, ANSWERS[1]!, 3600)
  }
  await film.shout(pA, 'Sharks, the price is free. Terms and conditions apply. Who is in?', 3600)
  await film.sayWhile(N.done, () => tap(pa.getByTestId('pw-done')))

  // ---------------------------------------------------------------- cheques 1
  for (const s of sharksA) await expect(film.page(s).getByTestId('pw-invest')).toBeVisible()
  film.caption('Secret cheques')
  film.spotlight(s1)
  await film.sayWhile(N.cheque, async () => {
    await ps1.waitForTimeout(1500)
    await tap(ps1.getByRole('button', { name: '₹5 cr', exact: true }))
    await ps1.waitForTimeout(900)
    await tap(ps1.getByTestId('pw-sign'))
    await tap(ps2.getByRole('button', { name: '₹3 cr', exact: true }))
    await tap(ps2.getByTestId('pw-sign'))
  })
  film.bubble(s3, 'Okay fine, take my money!', 2600)
  await tap(ps3.getByRole('button', { name: '₹7.5 cr', exact: true }))
  await film.pause(900)
  await tap(ps3.getByTestId('pw-sign'))

  // ---------------------------------------------------------------- reveal 1
  await expect(pa.getByTestId('pw-reveal')).toBeVisible()
  film.caption('The reveal')
  film.spotlight(pA)
  await film.say(N.reveal)
  await expect(pa.getByTestId('pw-verdict')).toBeVisible()
  film.bubble(mateA1, 'DEAL! Party at my place!', 2800)
  await film.say(N.deal)
  await tapIfThere(host, 'pw-next')

  // ---------------------------------------------------------------- pitch 2
  const pb = film.page(pB)
  await expect(pb.getByTestId('pw-stage').or(pb.getByTestId('pw-pitch'))).toBeVisible()
  film.caption(`Pitch 2 · ${pB} on the mic`)
  film.spotlight(pB)
  await film.sayWhile(N.swap, async () => {
    await pb.waitForTimeout(1500)
    await tapIfThere(pb, 'pw-start')
  })
  await expect(pb.getByTestId('pw-pitch')).toBeVisible()
  await film.shout(pB, hookB, 4000)
  await film.shout(pB, `Introducing ${nameB}! ${sloganB}`, 3600)
  await film.sayWhile(N.greedy, () => film.pause(500))
  await film.shout(pB, 'Ten crore for two percent. Final offer. No bargaining!', 3400)

  await film.cut(async () => {
    const sharksB = A.map((n) => film.page(n))
    await tap(sharksB[0]!.getByTestId('pw-question').first())
    await sharksB[1]!.waitForTimeout(600)
    await tap(pb.getByTestId('pw-done'))
    for (const p of sharksB) await expect(p.getByTestId('pw-invest')).toBeVisible()
    const amounts = ['₹1 cr', 'Out 🙅', '₹2 cr']
    for (let i = 0; i < sharksB.length; i++) {
      await tap(sharksB[i]!.getByRole('button', { name: amounts[i]!, exact: true }))
      await tap(sharksB[i]!.getByTestId('pw-sign'))
    }
    await expect(pb.getByTestId('pw-reveal')).toBeVisible()
  }, 'questions and cheques')

  film.caption('The reveal')
  film.spotlight(pB)
  await expect(pb.getByTestId('pw-verdict')).toBeVisible()
  film.bubble(pB, 'Wait, wait, I can explain!', 2600)
  await film.say(N.nodeal)
  await tapIfThere(host, 'pw-next')

  // ---------------------------------------------------------------- results
  await expect(host.getByTestId('results')).toBeVisible({ timeout: 30_000 })
  await scrollTop(host)
  film.caption('Results')
  film.spotlight(NAMES[0]!)
  await film.say(N.results)
  film.spotlight(null)
  film.focus(A)
  await film.say(N.outro)
  await film.pause(800)
  await film.finish()
})
