-- ===========================================================================
-- The words the daily DM is made of, and where the rotation is up to.
--
-- These were two arrays in Code.js (MESSAGES ~35, TRIVIA ~172) with their
-- positions in Script Properties (`currentStep`, `currentFact`). Moved verbatim
-- — the trivia was reviewed against primary sources for a 350-person,
-- India/Vietnam-heavy org, and re-typing it would quietly lose that work.
--
-- WHY TABLES AND NOT A JSON BLOB OR A CONSTANT IN THE FUNCTION
-- ---------------------------------------------------------------------------
-- Because somebody who is not an engineer needs to add to the trivia list, and
-- the whole point of leaving Apps Script is that content changes should not be
-- deploys. A row in a table is editable from the dashboard, or from the table
-- editor, by whoever owns the voice of this DM.
--
-- `ord` is the rotation position and the primary key, so re-running this seed
-- is an update rather than a duplicate. Gaps are fine: the sender takes the
-- next ord at or above its cursor and wraps at the end, so deleting a fact
-- nobody liked does not need a renumber.
-- ===========================================================================

create table if not exists "mission-hq".messages (
  ord        int primary key,
  body       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists "mission-hq".trivia (
  ord        int primary key,
  body       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table "mission-hq".messages is
  'Greeting line of the daily DM. {name} is substituted by the sender.';
comment on table "mission-hq".trivia is
  'The "Fun Fact:" line. Keep entries work-appropriate and globally neutral — '
  'this DM goes to the whole org across Bengaluru, Mumbai and Vietnam.';

-- ---------------------------------------------------------------------------
-- settings — small, named bits of state that are not rows of anything
--
-- Rotation cursors live here rather than in a column on a one-row table, so
-- that adding the next piece of state (an alert channel override, a pause
-- switch) does not need a migration.
-- ---------------------------------------------------------------------------
create table if not exists "mission-hq".settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table "mission-hq".settings is
  'Named scalars. jsonb so a new setting is an insert, not a migration.';

alter table "mission-hq".messages enable row level security;
alter table "mission-hq".trivia   enable row level security;
alter table "mission-hq".settings enable row level security;

-- The rotation only advances on a day a prompt actually went out, so weekends
-- and holidays never burn an entry — that behaviour came from Apps Script and
-- is worth keeping: it is why the list lasts a year rather than ten months.
insert into "mission-hq".settings (key, value) values
  ('prompt_rotation', '{"message_ord": 0, "trivia_ord": 0}'::jsonb)
on conflict (key) do nothing;

insert into "mission-hq".messages (ord, body) values
  (0, '🌍 Good morning, {name}! Where are you setting up camp today?'),
  (1, '📍 Hey {name}, quick one - office, home, or somewhere else today?'),
  (2, '👋 Morning, {name}! Drop your location so we know where to find you.'),
  (3, '🖥️ {name}, where''s your desk today? Office, home, or wild card?'),
  (4, '🗺️ Location check, {name}! Where are you plugged in today?'),
  (5, '🌤️ Rise and shine, {name}! What''s your base of operations today?'),
  (6, '🤝 Hey {name}, checking in - where are you working from today?'),
  (7, '🚀 {name}, mission briefing: what''s your launch pad today?'),
  (8, '🏢 Office or remote today, {name}? Let us know!'),
  (9, '💻 {name}, where''s your command center set up today?'),
  (10, '🌆 Top of the morning, {name}! Share your work spot for today.'),
  (11, '📅 {name}, office vibes or home vibes today? Drop your location!'),
  (12, '🤔 {name}, where are you being brilliant from today?'),
  (13, '🏠 Home, office, or surprise location, {name}? We''re curious!'),
  (14, '🧭 {name}, what are today''s coordinates? Let us know your location.'),
  (15, '🎪 Hey {name}! Main stage or backstage today? Share your location.'),
  (16, '⚡ Quick ping, {name} - where are you dialing in from today?'),
  (17, '🌅 New day, new location? {name}, let us know where you''ll be!'),
  (18, '☕ Coffee''s ready, {name}! Now tell us - where are you working today?'),
  (19, '🗓️ {name}, help us plan the day - what''s your work location?'),
  (20, '📱 Buzz buzz, {name}! Where''s your workspace today?'),
  (21, '🌐 {name}, what corner of the world are you working from today?'),
  (22, '🎯 {name}, where are you locking in and getting things done today?'),
  (23, '🛋️ Couch, desk, or co-working space, {name}? What''s the vibe today?'),
  (24, '🔔 Ding! {name}, time to share your work location for the day.'),
  (25, '🎒 {name}, are you on-site or off-site today? Let us know!'),
  (26, '🧳 Packed for office or staying home, {name}? Drop your location.'),
  (27, '🌻 Good morning, {name}! Where''s the productivity happening today?'),
  (28, '🗼 {name}, what''s your HQ for the day? Share your spot!'),
  (29, '🎧 Headphones on, {name}? Tell us where you''re zoning in from today.'),
  (30, '📌 Pin your location, {name}! Where are you working from today?'),
  (31, '🏖️ Desk, sofa, or beach? {name}, where are you logging in from today?'),
  (32, '🔑 {name}, unlock the day - tell us your work location!'),
  (33, '🌈 Happy morning, {name}! What''s your work setup today?'),
  (34, '🧊 Cool check-in, {name}: where are you stationed today?')
on conflict (ord) do update set body = excluded.body;

insert into "mission-hq".trivia (ord, body) values
  (0, 'Fish ''cough'' to clear debris out of their gills. 🐟'),
  (1, 'In 2023, India''s Chandrayaan-3 became the first mission ever to land near the Moon''s south pole - making India only the fourth country to reach the Moon''s surface. 🌗'),
  (2, 'Laughing is older than language - even tickled apes ''laugh.'' 😂'),
  (3, 'In Sweden, blood donors get a text when their blood is used to help someone. 🩸'),
  (4, 'Earth has more trees - over 3 trillion of them - than there are stars in our Milky Way galaxy. 🌳'),
  (5, 'The Moon drifts about 3.8 cm further away from Earth every year. 🌙'),
  (6, 'Playing board games is linked to a lower risk of dementia. 🎲'),
  (7, 'The tiny tardigrade, or ''water bear,'' can survive the raw vacuum of space - some lasted 10 days in orbit, then came home and laid healthy eggs. 🐻'),
  (8, 'Vietnam''s Hang Son Doong is the world''s largest cave - so vast it has its own jungle, river, and clouds inside. 🕳️'),
  (9, 'The Eiffel Tower was originally meant to be taken down after 20 years. 🗼'),
  (10, 'Swiss law effectively requires you to keep guinea pigs in pairs, because they get lonely. 🐹'),
  (11, 'A single teaspoon of a neutron star would weigh billions of tonnes - its matter is packed as tightly as an atom''s nucleus. ⭐'),
  (12, 'Koala fingerprints are so human-like they can confuse a crime scene. 🐨'),
  (13, 'Queen Elizabeth II trained as a mechanic and truck driver during World War II. 🔧'),
  (14, 'Wood frogs freeze almost solid in winter and thaw back to life in spring. 🐸'),
  (15, 'India reached Mars orbit on its very first attempt - and the Mangalyaan mission cost less to build than the Hollywood film ''Gravity.'' 🚀'),
  (16, 'Polar bears have black skin underneath their see-through, white-looking fur. 🐻‍❄️'),
  (17, 'A day on Venus is longer than its year - it spins slower than it orbits the Sun. 🪐'),
  (18, 'Chilled to about -271°C, helium becomes a ''superfluid'' with zero friction - it can even creep up and over the walls of its container. 🧪'),
  (19, 'Japanese macaques make snowballs and play with them for fun. ⛄'),
  (20, 'Naked mole-rats can survive around 18 minutes with no oxygen. 🐁'),
  (21, 'Scientists once levitated a live frog using powerful magnets. 🐸'),
  (22, 'Vietnam is the world''s second-largest coffee producer and its robusta powerhouse - the beans behind most of the world''s instant coffee. ☕'),
  (23, 'Beavers don''t live in their dams - they build separate lodges behind them. 🦫'),
  (24, 'Sharks are older than trees - they''ve been around for over 400 million years. 🦈'),
  (25, 'Your phone''s GPS stays accurate only because engineers correct its satellites for Einstein''s relativity - time really does tick faster up in orbit. 🛰️'),
  (26, 'Astronauts left a family photo on the Moon during Apollo 16. 🌑'),
  (27, 'It rains methane on Titan, Saturn''s largest moon. 🌧️'),
  (28, 'Toy dog breeds like Chihuahuas have some of the largest brains relative to body size - though it doesn''t make them the smartest. 🐕'),
  (29, 'Around 300 years before Leibniz, the 14th-century Kerala mathematician Madhava worked out an infinite series to calculate pi. 📐'),
  (30, 'The deep-sea glass sponge is among the longest-lived animals on Earth - one was estimated at about 11,000 years old. 🧽'),
  (31, 'Identical twins do not have the same fingerprints. 👯'),
  (32, 'A jellyfish called Turritopsis can revert from an adult back into its baby stage - which is why it''s nicknamed ''the immortal jellyfish.'' 🪼'),
  (33, 'Emperor penguins can dive as deep as 550 metres. 🐧'),
  (34, 'You can play with a yo-yo in space - an astronaut tried it on the Space Station. 🪀'),
  (35, 'Every Holstein cow''s black-and-white pattern is unique, like a fingerprint. 🐄'),
  (36, 'Vietnamese water puppetry is about 1,000 years old - performed on water, with the puppeteers hidden waist-deep behind a screen. 🎭'),
  (37, 'Axolotls can regrow lost limbs - and even parts of their brain. 🦎'),
  (38, 'Earth''s day is slowly getting longer - by roughly 1.8 seconds per century. 🌍'),
  (39, 'Helium was discovered on the Sun before it was ever found on Earth - spotted in sunlight in 1868 and named after the Greek sun god. ☀️'),
  (40, 'Greenland sharks can live for more than 400 years. 🦈'),
  (41, 'The universe has an average colour, and scientists named it ''Cosmic Latte.'' ☕'),
  (42, 'Finland hosts a Mobile Phone Throwing World Championship. 📱'),
  (43, 'Told that the number 1729 seemed ''dull,'' India''s Ramanujan instantly replied that it''s the smallest number that is a sum of two cubes in two different ways. 🚕'),
  (44, 'The oldest dog on record, an Australian cattle dog named Bluey, lived 29 years and 5 months. 🐶'),
  (45, 'Most orange cats are male, by about three to one - and in 2025 scientists finally pinned down the gene behind their colour. 🐈'),
  (46, 'The metal gallium melts in the warmth of your hand - it turns to liquid at just below body temperature. 🌡️'),
  (47, 'Honeypot ants store food by swelling their own bodies into living pantries. 🐜'),
  (48, 'Cows have best friends and get stressed when they''re separated. 🐄'),
  (49, 'Astronauts say space smells like seared steak, hot metal, and gunpowder. 🚀'),
  (50, 'Vietnamese has six tones, so a single syllable said six different ways can mean six completely different things. 🎵'),
  (51, 'Sheep can recognise and remember human faces. 🐑'),
  (52, 'Salvador Dali paid restaurant bills by drawing on the cheques, knowing no one would cash them. 🎨'),
  (53, 'Millions of tonnes of dust blow off the Sahara and across the Atlantic each year, fertilising the Amazon rainforest. 🏜️'),
  (54, 'Your nose can tell apart about a trillion different smells. 👃'),
  (55, 'Abraham Lincoln is the only U.S. president who ever held a patent. 💡'),
  (56, 'Simon Bolivar helped liberate five South American countries. 🌎'),
  (57, 'In 1980, Bengaluru-born Shakuntala Devi multiplied two random 13-digit numbers in her head in 28 seconds - a Guinness record. 🧮'),
  (58, 'Antarctica is the largest desert on Earth. 🏜️'),
  (59, 'Elephants comfort each other by gently stroking with their trunks. 🐘'),
  (60, 'The centre of the Earth is roughly as hot as the surface of the Sun - both around 5,500°C. 🌋'),
  (61, 'Sea otters hold hands while they sleep so they don''t drift apart. 🦦'),
  (62, 'The ruins of Pompeii include ancient take-out food counters. 🍲'),
  (63, 'Giraffes hum to each other during the night. 🦒'),
  (64, 'Near Da Nang, Vietnam''s Golden Bridge looks like it''s held up by two giant hands, sculpted to resemble weathered ancient stone. 🌉'),
  (65, 'Vietnam grows roughly 35-40% of the world''s black pepper - and handles over half of the world''s pepper exports. 🌶️'),
  (66, 'Google''s founders once tried to sell the whole company for under $1 million. 💻'),
  (67, 'Your brain is only about 2% of your body weight but burns roughly 20% of your energy, even at rest. 🧠'),
  (68, 'Bats aren''t blind - they see well and use echolocation too. 🦇'),
  (69, 'Sleep ''power-washes'' your brain, flushing out waste through fluid. 🧠'),
  (70, 'A penguin at Edinburgh Zoo has been knighted and promoted to brigadier. 🐧'),
  (71, 'The ''father of fibre optics'' - the technology behind today''s internet - was Punjab-born physicist Narinder Singh Kapany. 🔬'),
  (72, 'After breathing pure oxygen first, a Croatian freediver held his breath underwater for a record 29 minutes in 2025. 🫁'),
  (73, 'A shrimp''s heart is located in its head. 🦐'),
  (74, 'The first computer ''bug'' was a real one - a moth found inside a Harvard computer in 1947 and taped into the logbook. 🐛'),
  (75, 'There are stone circles even older than Stonehenge. 🪨'),
  (76, 'Cuckoos lay their eggs in other birds'' nests and let them do the parenting. 🐦'),
  (77, 'Dogs tilt their heads to better pick out familiar words. 🐶'),
  (78, 'Ha Long Bay means ''descending dragon'' - legend says a dragon scattered the emerald bay''s 1,000-plus limestone islands. 🐉'),
  (79, 'The only known T. rex skin impressions show scales - so the giant adult probably wasn''t feathered, even if some smaller cousins were. 🦖'),
  (80, 'A single horse can produce far more than one horsepower - up to about 15. 🐎'),
  (81, 'About 99% of the world''s international internet traffic travels through fibre-optic cables lying on the ocean floor. 🌐'),
  (82, '''Tsundoku'' is the Japanese word for buying books and never reading them. 📚'),
  (83, '''Petrichor'' is the name for the earthy smell of rain. 🌧️'),
  (84, 'A snail''s tongue can carry thousands of microscopic teeth. 🐌'),
  (85, 'India''s UPI system now handles close to half of all real-time digital payments made anywhere in the world. 📱'),
  (86, 'Cats were first domesticated around 9,500 years ago. 🐱'),
  (87, 'Genghis Khan granted religious freedom across his empire. 🏹'),
  (88, 'Shuffle a deck of cards well and you''ve almost certainly made an order that has never existed before - there are more ways to arrange 52 cards than there are atoms in the Earth. 🃏'),
  (89, 'In 1930 the BBC announced ''there is no news'' and played piano music instead. 📻'),
  (90, 'A reindeer''s eyes change from gold in summer to blue in winter. 🦌'),
  (91, 'Melbourne gave its trees email addresses - and people started writing them love letters. 🌳'),
  (92, 'Bhutan is the world''s only carbon-negative country - its forests soak up far more CO2 than the whole nation emits. 🌲'),
  (93, 'Apollo 17 astronaut Harrison Schmitt found out he was allergic to Moon dust. 🌕'),
  (94, 'NASA''s X-43 is the fastest jet ever built - it reached about 11,854 km/h. 🚀'),
  (95, 'In any random group of just 23 people, it''s more likely than not that two of them share the same birthday. 🎂'),
  (96, 'Comets can smell like rotten eggs, ammonia, and almonds. ☄️'),
  (97, 'From 1959 until satellite channels arrived in the early 1990s, Indian TV meant a single state broadcaster: Doordarshan. 📺'),
  (98, 'Wearing a tight tie can reduce blood flow to your brain by about 7.5%. 👔'),
  (99, 'Delhi''s 1,600-year-old Iron Pillar has barely rusted - its unusual iron quietly grows its own protective coating. 🏛️'),
  (100, 'Horseshoe crabs have blue blood that has helped save human lives. 🦀'),
  (101, 'Flowers only appeared on Earth around 130 million years ago. 🌸'),
  (102, 'Woolly mammoths were still alive when the ancient Egyptians were building the pyramids. 🦣'),
  (103, 'Scotland''s official national animal is the unicorn. 🦄'),
  (104, 'A double rainbow''s second arc has its colours in reverse order. 🌈'),
  (105, 'Martin Luther King Jr. once got a C in a public speaking class. 🎤'),
  (106, 'Japan''s bullet train got its long nose from a bird - engineers copied a kingfisher''s beak to make it quieter and faster. 🐦'),
  (107, 'Newborn babies have about 100 more bones than adults do. 🦴'),
  (108, 'A pistol shrimp snaps its claw so fast it creates a bubble hotter than lava. 🦐'),
  (109, 'At least half of the oxygen you breathe is made by microscopic plankton in the ocean - not by forests. 🌊'),
  (110, 'Goats have rectangular pupils, giving them a very wide field of view. 🐐'),
  (111, 'Africa is the only continent that sits in all four hemispheres. 🌍'),
  (112, 'Taipei''s garbage trucks play Beethoven''s ''Fur Elise'' so people know to bring out the trash. 🎶'),
  (113, 'Jaipur''s 18th-century Jantar Mantar has a 27-metre stone sundial that still tells the time to within about two seconds. 🕰️'),
  (114, 'The belief that paper can''t be folded in half more than 8 times is a myth - a student folded a single sheet 12 times in 2002. 📄'),
  (115, 'Marie Curie is the only person to win Nobel Prizes in two different sciences. 🥼'),
  (116, 'The word ''robot'' is only about a century old - it comes from a Czech word for forced labour and first appeared in a 1920 play. 🤖'),
  (117, 'The woman who founded Mother''s Day later campaigned to abolish it. 🌸'),
  (118, 'The ''new car smell'' is actually a mix of more than 200 different chemicals. 🚗'),
  (119, 'Avocados only ripen after they''re picked, never on the tree. 🥑'),
  (120, 'Singapore purifies used water into ultra-clean ''NEWater'' - clean enough to supply up to 40% of the country''s water needs. 💧'),
  (121, 'Flamingos are born grey and turn pink from the food they eat. 🦩'),
  (122, 'Continental plates drift about as fast as your fingernails grow. 🌍'),
  (123, 'Sound travels about four times faster through water than through air. 🔊'),
  (124, 'Ganymede, one of Jupiter''s moons, is larger than the planet Mercury. 🌕'),
  (125, 'A starfish is basically all head - it has no body. ⭐'),
  (126, 'The Statue of Liberty was a shiny copper-brown before it slowly turned green. 🗽'),
  (127, 'Mawsynram, a village in Meghalaya, records the highest average annual rainfall on Earth - close to 12 metres a year. 🌧️'),
  (128, 'The medical name for brain freeze is ''sphenopalatine ganglioneuralgia.'' 🍦'),
  (129, 'Kea parrots have an ''infectious laugh'' - a happy call that spreads through the flock. 🦜'),
  (130, 'The Sun holds about 99.8% of all the mass in our entire solar system. 🌞'),
  (131, 'France requires large supermarkets to donate or compost unsold food. 🥖'),
  (132, 'A U.S. Navy base is partly guarded by trained bottlenose dolphins. 🐬'),
  (133, 'The ampersand (&) comes from the Latin word ''et,'' meaning ''and.'' 🔣'),
  (134, 'In the Philippines, the Puerto Princesa river runs 8 km through a mountain cave before flowing into the sea - and its lower reaches rise and fall with the tides. 🚣'),
  (135, 'Dogs can learn around 250 words - roughly like a 2-year-old child. 🐕'),
  (136, 'A lightning bolt is about five times hotter than the surface of the Sun. ⚡'),
  (137, 'Mercury and bromine are the only two elements that are liquid at ordinary room temperature. ⚗️'),
  (138, 'The largest butterfly, the Queen Alexandra''s Birdwing, has a wingspan of about 31 cm. 🦋'),
  (139, 'Mauna Kea is taller than Mount Everest when measured from its base on the seafloor. 🌋'),
  (140, 'A badminton shuttlecock''s feathers all come from the same wing of a goose, so they all spin the same way. 🏸'),
  (141, 'In rain-soaked Meghalaya, Khasi villagers don''t build their bridges - they grow them from living tree roots over decades. 🌱'),
  (142, 'The quietest place on Earth is a Microsoft lab measured at -20.6 decibels. 🔇'),
  (143, 'LEGO keeps a secret vault holding every set the company has ever made. 🧱'),
  (144, 'You''re about a centimetre taller in the morning than at night - your spinal discs slowly compress as the day goes on. 📏'),
  (145, 'Sperm whales can dive nearly 3 km down to hunt giant squid. 🐋'),
  (146, 'A rodent''s front teeth never stop growing. 🐀'),
  (147, 'Ethiopia''s calendar has 13 months. 📅'),
  (148, 'Korea''s Hangul is one of the only alphabets in history with a known inventor and launch date - King Sejong unveiled it in 1446. ✍️'),
  (149, 'Jupiter has the shortest day of any planet - it spins once in about 10 hours. 🪐'),
  (150, 'The peregrine falcon is the fastest animal, diving at around 240 mph. 🦅'),
  (151, 'Oxford University was already teaching students before the Aztec capital of Tenochtitlan was even founded. 📚'),
  (152, '''Deja reve'' is the eerie feeling that you''ve dreamed something before. 💭'),
  (153, 'Neil Armstrong''s astronaut application arrived late - a friend slipped it into the pile. 🚀'),
  (154, 'Bumblebees have been found flying more than 3 km above sea level. 🐝'),
  (155, 'Every winter, over 100,000 flamingos turn the mudflats of Mumbai''s Thane Creek pink. 🦩'),
  (156, 'Albatrosses can stay airborne for months at a time and circle the globe. 🕊️'),
  (157, 'You carry roughly as many bacterial cells as your own cells - about 1.3 to 1, not the ''10 to 1'' often repeated. 🦠'),
  (158, 'Silbo Gomero is a real whistled language, used to ''talk'' across the deep valleys of one of the Canary Islands. 🏝️'),
  (159, 'Crows understand simple physics about as well as a 6-month-old baby. 🐦‍⬛'),
  (160, 'On average, Mercury is the closest planet to Earth. 🪐'),
  (161, '''Four'' is the only number in English spelled with as many letters as its value. 4️⃣'),
  (162, 'The Komodo dragon - the world''s largest lizard, up to 3 metres long - lives wild nowhere on Earth except Indonesia. 🦎'),
  (163, 'Peru is the only country whose English name can be typed on a single keyboard row. ⌨️'),
  (164, 'In colonial America, lobster was so common it was fed to prisoners. 🦞'),
  (165, 'Pune''s Serum Institute is the world''s largest vaccine maker - by its own estimate, most of the world''s children get at least one vaccine made there. 💉'),
  (166, 'Hippos can''t actually swim - they push off the riverbed and ''gallop'' underwater. 🦛'),
  (167, 'Barcelona has playgrounds designed specifically for senior citizens. 🛝'),
  (168, 'The little dot above a lowercase ''i'' or ''j'' is called a ''tittle.'' 🔤'),
  (169, 'The word ''shampoo'' comes from the Hindi ''champo,'' meaning to press or massage, and entered English back in the 1760s. 🧴'),
  (170, 'Cashews grow attached to a fruit called the cashew apple. 🥜'),
  (171, 'Volvo gave away its three-point seatbelt patent so other carmakers could save lives. 🚗')
on conflict (ord) do update set body = excluded.body;
-- Trivia is finite. The sender alerts when the cursor is within the last
-- few, because running out silently makes every DM identical.
