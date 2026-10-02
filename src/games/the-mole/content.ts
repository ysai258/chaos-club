/** The Mole — challenge content. Server only; never import from src/web. */

/** Heat Scale (Ito-style lining up). 1 = low end, 100 = high end. */
export const HEAT_THEMES: { scale: string; low: string; high: string }[] = [
  { scale: 'How spicy', low: 'Curd rice', high: 'Bhut jolokia chutney' },
  { scale: 'How desi', low: 'Avocado toast', high: 'Pressure cooker on its 4th whistle' },
  { scale: 'How scary', low: 'A sleepy kitten', high: 'An income tax notice' },
  { scale: 'How awkward', low: 'Saying "you too" to the waiter', high: 'Mom reading your search history' },
  { scale: 'How expensive', low: 'Cutting chai', high: 'A 2BHK in Bandra' },
  { scale: 'How smelly', low: 'Fresh mogra flowers', high: 'Boys hostel at 2am' },
  { scale: 'How loud', low: 'Library whisper', high: 'Baraat dhol at full josh' },
  { scale: 'How useful in a zombie apocalypse', low: 'Scented candle', high: 'Cricket bat' },
  { scale: 'How filmy', low: 'Filing GST returns', high: 'Slow-mo rain dance in Switzerland' },
  { scale: 'How healthy', low: 'Midnight jalebi', high: 'Sprouts salad' },
  { scale: 'How romantic', low: 'Splitting the bill to the rupee', high: 'Proposing at the Taj at sunrise' },
  { scale: 'How risky to post in the family WhatsApp group', low: 'Good morning roses', high: 'Your Goa trip photos' },
  { scale: 'How hard', low: 'Breathing', high: 'Booking a Tatkal ticket at 10:00:01' },
  { scale: 'How annoying', low: 'A light drizzle', high: 'Neighbour drilling at 7am on Sunday' },
  { scale: 'How fancy', low: 'Plastic chair', high: 'Five-star Sunday brunch' },
  { scale: 'How sweet', low: 'Karela juice', high: 'Gulab jamun in extra syrup' },
  { scale: 'How cringe', low: 'A firm handshake', high: 'Your 2012 Facebook posts' },
  { scale: 'How big', low: 'A grain of rice', high: 'A big fat wedding guest list' },
  { scale: 'How fast', low: 'A government office file', high: 'Gossip in a housing society' },
  { scale: 'How famous', low: 'Your building watchman', high: 'Shah Rukh Khan' },
  { scale: 'How old', low: "Today's meme", high: "Dad's Bajaj scooter" },
  { scale: 'How chaotic', low: 'A silent meditation retreat', high: 'A sangeet rehearsal the night before' },
  { scale: 'How gross a food combo', low: 'Chai + Parle-G', high: 'Maggi with ice cream' },
  { scale: 'How sleepy it makes you', low: 'A thriller climax', high: 'A Monday 9am meeting' },
  { scale: 'How much you would pay for it', low: 'A used toothbrush', high: 'A front-row IPL final seat' },
  { scale: 'How likely to make an uncle cry', low: 'A new phone tutorial', high: 'An old Kishore Kumar song' },
]

/** Intel Board categories. Each needs ≥ 10 options. */
export const INTEL_CATEGORIES: { name: string; options: string[] }[] = [
  { name: 'Indian cities', options: ['Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Jaipur', 'Lucknow', 'Ahmedabad', 'Kochi', 'Indore'] },
  { name: 'Street foods', options: ['Vada pav', 'Pani puri', 'Momos', 'Samosa', 'Pav bhaji', 'Dosa', 'Chole bhature', 'Kathi roll', 'Dabeli', 'Bhel puri', 'Jalebi'] },
  { name: 'Bollywood films', options: ['Sholay', 'DDLJ', 'Lagaan', '3 Idiots', 'Dangal', 'ZNMD', 'Andaz Apna Apna', 'Dil Chahta Hai', 'Queen', 'Jab We Met', 'Hera Pheri'] },
  { name: 'Cricketers', options: ['Sachin', 'Dhoni', 'Kohli', 'Rohit', 'Dravid', 'Ganguly', 'Kumble', 'Kapil Dev', 'Bumrah', 'Yuvraj', 'Sehwag'] },
  { name: 'Apps on your phone', options: ['WhatsApp', 'Instagram', 'Zomato', 'Swiggy', 'Paytm', 'Google Pay', 'Uber', 'Ola', 'Netflix', 'Spotify', 'Hotstar'] },
  { name: 'Festivals', options: ['Diwali', 'Holi', 'Eid', 'Christmas', 'Onam', 'Pongal', 'Navratri', 'Durga Puja', 'Lohri', 'Ganesh Chaturthi', 'Baisakhi'] },
  { name: 'Animals', options: ['Tiger', 'Elephant', 'Peacock', 'Cobra', 'Monkey', 'Cow', 'Camel', 'Rhino', 'Leopard', 'Parrot', 'Crocodile'] },
  { name: 'Mithai', options: ['Gulab jamun', 'Rasgulla', 'Jalebi', 'Kaju katli', 'Gajar halwa', 'Kulfi', 'Ladoo', 'Rasmalai', 'Payasam', 'Mysore pak', 'Shrikhand'] },
  { name: 'Party games', options: ['Ludo', 'Carrom', 'Chess', 'Antakshari', 'Uno', 'Monopoly', 'Snakes & Ladders', 'Dumb charades', 'Pictionary', 'Housie', 'Truth or Dare'] },
  { name: "Things in mom's handbag", options: ['Safety pins', 'Hajmola', 'Tissues', 'Comb', 'Vicks', 'Band-aid', 'Polythene bag', 'Keys', 'Charger', 'Mints', 'Old bills'] },
  { name: 'Hill stations', options: ['Shimla', 'Manali', 'Ooty', 'Munnar', 'Darjeeling', 'Mussoorie', 'Gangtok', 'Coorg', 'Kodaikanal', 'Nainital', 'Lonavala'] },
  { name: 'Rivers', options: ['Ganga', 'Yamuna', 'Brahmaputra', 'Godavari', 'Krishna', 'Kaveri', 'Narmada', 'Tapi', 'Mahanadi', 'Sutlej', 'Chenab'] },
]

/** Ballpark questions. `tol` = how close the team's answer must land. */
export const BALLPARK: { q: string; a: number; tol: number; unit: string }[] = [
  { q: 'How tall is the Qutub Minar?', a: 73, tol: 10, unit: 'metres' },
  { q: 'In which year did Sholay release?', a: 1975, tol: 4, unit: '' },
  { q: 'How many seats are in the Lok Sabha?', a: 543, tol: 60, unit: 'seats' },
  { q: 'How many bones in an adult human body?', a: 206, tol: 25, unit: 'bones' },
  { q: 'How many keys on a standard piano?', a: 88, tol: 10, unit: 'keys' },
  { q: 'How tall is Mount Everest?', a: 8849, tol: 600, unit: 'metres' },
  { q: 'In which year was the first IPL season?', a: 2008, tol: 2, unit: '' },
  { q: 'In which year did India first win the Cricket World Cup?', a: 1983, tol: 4, unit: '' },
  { q: 'How many international centuries did Sachin score?', a: 100, tol: 10, unit: 'centuries' },
  { q: 'How tall is the Statue of Unity?', a: 182, tol: 25, unit: 'metres' },
  { q: 'How tall is the Burj Khalifa?', a: 828, tol: 90, unit: 'metres' },
  { q: 'In which year did humans first land on the Moon?', a: 1969, tol: 4, unit: '' },
  { q: 'How many seconds are there in one day?', a: 86400, tol: 9000, unit: 'seconds' },
  { q: 'How long is a cricket pitch?', a: 22, tol: 3, unit: 'yards' },
  { q: 'In which year did DDLJ release?', a: 1995, tol: 3, unit: '' },
  { q: 'How many squares on a chessboard (the 8×8 ones)?', a: 64, tol: 8, unit: 'squares' },
  { q: 'At what temperature does water boil, in Fahrenheit?', a: 212, tol: 20, unit: '°F' },
  { q: 'How fast does sound travel in air?', a: 343, tol: 45, unit: 'm/s' },
  { q: 'How many languages are in the 8th Schedule of the Constitution?', a: 22, tol: 3, unit: 'languages' },
  { q: 'How far is the Moon from Earth, on average?', a: 384, tol: 45, unit: 'thousand km' },
  { q: 'In which year did construction of the Taj Mahal begin?', a: 1632, tol: 15, unit: '' },
  { q: 'How many states does India have?', a: 28, tol: 3, unit: 'states' },
  { q: 'How many Earth days does Mars take to orbit the Sun?', a: 687, tol: 80, unit: 'days' },
  { q: 'In which year was the first Harry Potter book published?', a: 1997, tol: 3, unit: '' },
  { q: 'In which year did Doordarshan start broadcasting?', a: 1959, tol: 6, unit: '' },
  { q: 'In which year was the Gateway of India completed?', a: 1924, tol: 8, unit: '' },
  { q: 'How many teeth does an adult human usually have?', a: 32, tol: 4, unit: 'teeth' },
  { q: 'How many ODI runs did Sachin Tendulkar score?', a: 18426, tol: 2000, unit: 'runs' },
  { q: 'How tall is the Eiffel Tower?', a: 330, tol: 40, unit: 'metres' },
  { q: 'How many hours are in a (non-leap) year?', a: 8760, tol: 900, unit: 'hours' },
  { q: 'In which year did Kaun Banega Crorepati first air?', a: 2000, tol: 3, unit: '' },
  { q: 'In which year was Google founded?', a: 1998, tol: 3, unit: '' },
  { q: 'In which year did the first iPhone launch?', a: 2007, tol: 2, unit: '' },
  { q: 'How many minutes in a standard football match (no extra time)?', a: 90, tol: 10, unit: 'minutes' },
]

/** Stock Tip companies. */
export const STOCKS: string[] = [
  'Chai Point Futures', 'Jugaad Robotics', 'Maggi Minute Holdings', 'Bhaiya Ji Logistics', 'Rickshaw Rapid Ltd',
  'Shaadi Drone Co.', 'Pressure Cooker Labs', 'Tatkal Tech', 'Momo Motors', 'Thali Quantum',
  'Desi Crypto Coin', 'Lassi Aerospace', 'Pani Puri Pipelines', 'Jalebi Fintech', 'Auto Uncle Unicorn',
  'Ghar Ka Khana AI', 'Nimbu Mirchi Security', 'Filter Kaapi Capital', 'Dabba Network', 'Chappal Express',
  'Gully Cricket Media', 'Bournvita Biotech', 'Hajmola Health', 'Masala Cloud Services', 'Paneer Power Grid',
  'Vada Pav Ventures', 'Antakshari Audio', 'Ladoo Logistics',
]

/** Blind Spot grids: 9 words each. */
export const BLIND_GRIDS: { name: string; words: string[] }[] = [
  { name: 'Food', words: ['Biryani', 'Dosa', 'Samosa', 'Momos', 'Pizza', 'Paneer', 'Maggi', 'Idli', 'Paratha'] },
  { name: 'Movies', words: ['Sholay', 'Lagaan', 'Dangal', 'Don', 'PK', 'Queen', 'Baahubali', 'Kahaani', 'Dhoom'] },
  { name: 'Places', words: ['Goa', 'Ladakh', 'Kerala', 'Mumbai', 'Delhi', 'Agra', 'Shimla', 'Rishikesh', 'Jaipur'] },
  { name: 'Things at home', words: ['Umbrella', 'Pressure cooker', 'Remote', 'Chappal', 'Helmet', 'Mirror', 'Charger', 'Pillow', 'Bucket'] },
  { name: 'Jobs', words: ['Doctor', 'Pilot', 'Chef', 'Teacher', 'Cricketer', 'Astronaut', 'Lawyer', 'Farmer', 'Detective'] },
  { name: 'Animals', words: ['Tiger', 'Elephant', 'Peacock', 'Penguin', 'Monkey', 'Shark', 'Camel', 'Owl', 'Snake'] },
  { name: 'Weddings', words: ['Mehendi', 'Baraat', 'Dhol', 'Sherwani', 'Lehenga', 'Mandap', 'Buffet', 'Horse', 'Sangeet'] },
  { name: 'Sports', words: ['Cricket', 'Kabaddi', 'Football', 'Chess', 'Badminton', 'Hockey', 'Wrestling', 'Carrom', 'Tennis'] },
  { name: 'Nature', words: ['Monsoon', 'Rainbow', 'Thunder', 'Desert', 'Volcano', 'Glacier', 'Cyclone', 'Sunset', 'Fog'] },
  { name: 'Tech', words: ['WhatsApp', 'Wi-Fi', 'Password', 'Selfie', 'Emoji', 'Laptop', 'Netflix', 'Bluetooth', 'Battery'] },
  { name: 'Office', words: ['Meeting', 'Deadline', 'Boss', 'Appraisal', 'Coffee', 'Excel', 'Holiday', 'Resignation', 'Lunch'] },
  { name: 'Heroes', words: ['Hanuman', 'Krrish', 'Spider-Man', 'Batman', 'Shaktimaan', 'Thor', 'Arjun', 'Ravan', 'Iron Man'] },
  { name: 'College', words: ['Hostel', 'Canteen', 'Exam', 'Bunk', 'Fest', 'Attendance', 'Viva', 'Crush', 'Placement'] },
  { name: 'Travel', words: ['Passport', 'Train', 'Suitcase', 'Beach', 'Hotel', 'Map', 'Visa', 'Airport', 'Camera'] },
]

/** Flavour for the number challenges. */
export const SAFES: string[] = [
  "Sharma-ji's locker", 'the hostel warden\'s drawer', 'the shaadi gift vault', 'the RBI basement (allegedly)',
  "Nani's steel almirah", 'the office pantry fridge', 'the ATM that only gives ₹2000 notes', 'the Kohinoor backup safe',
  'the society secretary\'s cupboard', 'the cricket kit room',
]
export const GUARDS: string[] = [
  'Gupta-ji the night guard', 'Bouncer Bunty', 'Watchman Bahadur', 'Club doorman Rocky', 'Toll-booth Tiwari',
  'Hostel warden Mrs. D\'Souza', 'Gatekeeper Ganpat', 'Security uncle Surinder', 'Ticket checker Tripathi', 'Lift-man Lalit',
]
export const HEISTS: string[] = [
  'the Ambani wedding cake', 'the last plate of biryani', "Dad's TV remote", 'the office AC remote', 'the IPL trophy',
  "Mom's secret pickle jar", 'the hostel Wi-Fi password', 'the Kohinoor', 'the golden Maggi packet', 'the aux cable',
]
export const DOORS: string[] = [
  'the server room', 'the rooftop party', 'the principal\'s office', 'the snack cupboard', 'the VIP lounge',
  'the society clubhouse', 'the backstage at Sunburn', 'the bank vault', 'the cinema projector room', 'the secret chai stall',
]
