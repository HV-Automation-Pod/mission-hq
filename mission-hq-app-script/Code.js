const MESSAGES = [
  "🌍 Good morning, {name}! Where are you setting up camp today?",
  "📍 Hey {name}, quick one - office, home, or somewhere else today?",
  "👋 Morning, {name}! Drop your location so we know where to find you.",
  "🖥️ {name}, where's your desk today? Office, home, or wild card?",
  "🗺️ Location check, {name}! Where are you plugged in today?",
  "🌤️ Rise and shine, {name}! What's your base of operations today?",
  "🤝 Hey {name}, checking in - where are you working from today?",
  "🚀 {name}, mission briefing: what's your launch pad today?",
  "🏢 Office or remote today, {name}? Let us know!",
  "💻 {name}, where's your command center set up today?",
  "🌆 Top of the morning, {name}! Share your work spot for today.",
  "📅 {name}, office vibes or home vibes today? Drop your location!",
  "🤔 {name}, where are you being brilliant from today?",
  "🏠 Home, office, or surprise location, {name}? We're curious!",
  "🧭 {name}, what are today's coordinates? Let us know your location.",
  "🎪 Hey {name}! Main stage or backstage today? Share your location.",
  "⚡ Quick ping, {name} - where are you dialing in from today?",
  "🌅 New day, new location? {name}, let us know where you'll be!",
  "☕ Coffee's ready, {name}! Now tell us - where are you working today?",
  "🗓️ {name}, help us plan the day - what's your work location?",
  "📱 Buzz buzz, {name}! Where's your workspace today?",
  "🌐 {name}, what corner of the world are you working from today?",
  "🎯 {name}, where are you locking in and getting things done today?",
  "🛋️ Couch, desk, or co-working space, {name}? What's the vibe today?",
  "🔔 Ding! {name}, time to share your work location for the day.",
  "🎒 {name}, are you on-site or off-site today? Let us know!",
  "🧳 Packed for office or staying home, {name}? Drop your location.",
  "🌻 Good morning, {name}! Where's the productivity happening today?",
  "🗼 {name}, what's your HQ for the day? Share your spot!",
  "🎧 Headphones on, {name}? Tell us where you're zoning in from today.",
  "📌 Pin your location, {name}! Where are you working from today?",
  "🏖️ Desk, sofa, or beach? {name}, where are you logging in from today?",
  "🔑 {name}, unlock the day - tell us your work location!",
  "🌈 Happy morning, {name}! What's your work setup today?",
  "🧊 Cool check-in, {name}: where are you stationed today?",
];

const TRIVIA = [
  "The world's first alarm clock could only ring at 4 AM - it had no way to change the time. ⏰",
  "Mosquitoes are attracted to people who just ate bananas. 🦟",
  "The world's first computer weighed more than 27 tons and took up an entire room. 🖥️",
  "Nintendo was founded in 1889 as a playing card company. 🎴",
  "The longest word you can type with only the left hand on a QWERTY keyboard is 'stewardesses.' ⌨️",
  "A jiffy is an actual unit of time - it's 1/100th of a second. ⏱️",
  "The smell of freshly cut grass is actually a plant distress signal. 🌿",
  "Oxford University is older than the Aztec Empire. 🎓",
  "The world's largest snowflake on record was 15 inches wide. ❄️",
  "The world's oldest known board game is called Senet - it was played in ancient Egypt over 5,000 years ago. 🎲",
  "The average person spends 6 months of their lifetime waiting for red lights to turn green. 🚦",
  "The world's first vending machine was invented in ancient Egypt to dispense holy water. 🏛️",
  "Astronauts grow up to 2 inches taller in space because of reduced gravity on the spine. 🧑‍🚀",
  "The original name for the search engine Google was 'Backrub.' 🔍",
  "Movie trailers were originally shown after the movie - that's why they're called 'trailers.' 🎬",
  "The hashtag symbol (#) is technically called an 'octothorpe.' #️⃣",
  "Sunflowers can be used to clean up radioactive waste through a process called phytoremediation. 🌻",
  "The world's largest tire manufacturer is LEGO - they make over 300 million tiny tires a year. 🧱",
  "A photon takes about 8 minutes to travel from the Sun to Earth, but 100,000 years to get from the Sun's core to its surface. ☀️",
  "There's a planet made almost entirely of diamond - it's called 55 Cancri e. 💎",
  "Alaska is simultaneously the most northern, western, and eastern state in the U.S. 🗺️",
  "The Twitter bird's official name is Larry, named after basketball player Larry Bird. 🐦",
  "A group of pugs is called a 'grumble.' 🐶",
  "The first computer virus was created in 1986 and was called 'Brain.' 💻",
  "Ketchup was sold as medicine in the 1830s. 🍅",
  "The surface area of Russia is slightly larger than the surface area of Pluto. 🌍",
  "Only 5% of the ocean has been explored - we know more about the Moon's surface. 🌊",
  "The average person will spend about one year of their life looking for lost items. 🔎",
  "Bubble wrap was originally invented as wallpaper. 🫧",
  "The first oranges weren't orange - they were green. 🍊",
  "The average person blinks about 15-20 times per minute - that's up to 1,200 times per hour. 👁️",
  "Honey is the only food that includes all the substances necessary to sustain life. 🍯",
  "The inventor of the chocolate chip cookie sold the recipe for a lifetime supply of chocolate. 🍪",
  "Cheetahs can't roar - they chirp and purr like house cats. 🐆",
  "The moon has moonquakes, similar to earthquakes, caused by the gravitational pull of Earth. 🌙",
  "Lemons float in water, but limes sink. 🍋",
  "The shortest complete sentence in English is 'I am.' 📖",
  "A group of owls is called a 'parliament.' 🦉",
  "The code name for the first iPhone was 'Purple.' 📱",
  "Pigeons can do math - they've been trained to learn abstract numerical rules. 🐦",
  "The world's oldest known recipe is for beer - it's about 4,000 years old. 🍺",
  "A single Google search uses more computing power than the entire Apollo 11 mission to the Moon. 🖥️",
  "New York City was briefly the capital of the United States from 1785 to 1790. 🗽",
  "The longest musical performance in history is still ongoing - it started in 2001 and is scheduled to end in 2640. 🎵",
  "Apples belong to the rose family. 🌹",
  "The national anthem of Spain has no words. 🇪🇸",
  "Japan has over 6,800 islands but most people live on just four of them. 🇯🇵",
  "A snail can sleep for three years straight. 🐌",
  "The world record for most T-shirts worn at once is 260. 👕",
  "The first website ever created is still online - it was made by Tim Berners-Lee in 1991. 🌐",
  "The first email ever sent was in 1971 - the message was just a test string of characters. 📧",
  "The average cloud travels at about 30-40 mph. ☁️",
  "The world consumes about 2.25 billion cups of coffee every day. ☕",
  "Cats can rotate their ears 180 degrees. 🐱",
  "The first toy advertised on television was Mr. Potato Head in 1952. 🥔",
  "There are more possible iterations of a game of chess than atoms in the observable universe. ♟️",
  "The average person will eat around 35 tons of food in their lifetime. 🍽️",
  "Dolphins have names for each other and respond when called. 🐬",
  "Humans are the only animals that blush. 😊",
  "The world's first traffic light was installed in London in 1868. 🚦",
  "The shortest commercial flight in the world takes just 57 seconds. ✈️",
  "There's a hotel in Sweden made entirely of ice - it's rebuilt every winter. 🧊",
  "The average smartphone today has more computing power than NASA had during the 1969 Moon landing. 📲",
  "A day on Mercury lasts 59 Earth days. 🪐",
  "Some cats are allergic to humans. 🐈‍⬛",
  "The word 'muscle' comes from the Latin word for 'little mouse' - because flexed muscles looked like mice under the skin. 💪",
  "Playing video games can improve your decision-making speed by 25%. 🎮",
  "The first computer programmer in history was Ada Lovelace, way back in the 1840s. 👩‍💻",
  "Switzerland has enough bunkers to shelter its entire population. 🇨🇭",
  "The Sahara Desert is roughly the same size as the entire United States. 🏜️",
  "Bees can recognize human faces. 🐝",
  "The piano has over 12,000 individual parts. 🎹",
  "Venus spins in the opposite direction to most planets. 🪐",
  "There are more public libraries in the U.S. than McDonald's. 📚",
  "Spotify has over 100 million songs in its library. 🎶",
  "The first photograph ever taken required an 8-hour exposure. 📷",
  "The Rubik's Cube has 43 quintillion possible combinations. 🧩",
  "The average pencil can draw a line 35 miles long. ✏️",
  "Greenland is the world's largest island that isn't a continent. 🏝️",
  "The Space Station orbits Earth every 90 minutes. 🛸",
  "Sanskrit is considered the oldest language in the world. 📜",
  "The human eye can distinguish about 10 million different colors. 🌈",
  "An average person has about 70,000 thoughts per day. 🧠",
  "The Tokyo subway system moves over 8 million people daily. 🚇",
  "A hummingbird can fly backwards. 🐦",
  "The Taj Mahal appears to change color throughout the day. 🕌",
  "South Korea has the fastest average internet speed in the world. 🌐",
  "A baby elephant can stand within 20 minutes of being born. 🐘",
  "Bananas grow upside down - they curve upward toward the sun. 🍌",
  "Earth's core is as hot as the surface of the Sun. 🌍",
  "The average person laughs about 15 times a day. 😄",
  "The Mona Lisa has no eyebrows - it was the fashion in the 1500s. 🎨",
  "Mount Everest grows about 4 millimeters every year. 🏔️",
  "The first ever game of basketball used a peach basket as the hoop. 🏀",
  "Water can boil and freeze at the same time - it's called the triple point. 💧",
  "Cotton candy was invented by a dentist. 🍭",
  "The world's smallest country, Vatican City, is only 0.17 square miles. 🏰",
  "A rainbow can only be seen in the morning or late afternoon. 🌈",
  "Canada has the longest coastline of any country in the world. 🇨🇦",
  "The Great Barrier Reef is visible from space. 🪸",
  "Honey bees visit about 2 million flowers to make one pound of honey. 🍯",
  "Antarctica is the driest continent on Earth. 🧊",
  "The inventor of Wi-Fi was an Australian astrophysicist. 📡",
  "The Olympic flag's five rings represent five continents. 🏅",
  "There are about 7,000 languages spoken in the world today. 🗣️",
  "The Amazon River has no bridges crossing it. 🌳",
  "A chameleon's tongue can be twice the length of its body. 🦎",
  "Figs are technically inverted flowers, not fruits. 🌸",
  "There are about 2,000 thunderstorms happening on Earth at any given moment. ⛈️",
  "The world's largest library, the Library of Congress, has over 170 million items. 📖",
  "The Eiffel Tower can be 15 cm taller during summer due to heat. 🗼",
  "Maple syrup was discovered by Indigenous peoples of North America centuries ago. 🍁",
  "The Sun makes up 99.86% of all mass in our solar system. ☀️",
  "New Zealand was the first country to give women the right to vote in 1893. 🇳🇿",
];

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      throw new Error("No postData or contents in the request");
    }

    const rawPayload = e.postData.contents.split('=')[1];
    const decodedPayload = decodeURIComponent(rawPayload);
    const payload = JSON.parse(decodedPayload);
    logToDumpSheet("Parsed payload: " + JSON.stringify(payload));

    if (payload.type === 'block_actions') {
      const userInfo = getUserData(payload.user.id)
      const userName = userInfo?.name;
      const userEmail = userInfo?.email;
      const firstAction = payload.actions && payload.actions[0];
      const actionValue = firstAction ? firstAction.value : undefined;
      const actionType = firstAction ? firstAction.type : undefined;
      const messageTimestamp = payload.message.ts;
      const channelId = payload.channel.id;
      const userId = payload.user.id

      logToDumpSheet(`Processing interaction for user: ${userName}, email: ${userEmail}, channel: ${channelId}, action: ${actionValue || actionType}`);

      if (actionType === "static_select") {
        return ContentService.createTextOutput('');
      }

      if (actionValue && actionValue.startsWith("submit_location_")) {
        handleLocationsPayload(payload, actionValue, userEmail, channelId, messageTimestamp, userId);
      } else {
        logToDumpSheet(`Unsupported action: ${actionValue || actionType}`);
        return ContentService.createTextOutput('Unsupported action');
      }

      logToDumpSheet(`Interaction processed successfully for user: ${userName}`);
      return ContentService.createTextOutput('Interaction processed successfully');
    } else {
      return ContentService.createTextOutput('Unsupported payload type');
    }
  } catch (error) {
    logToDumpSheet('Error in doPost: ' + error.toString());
    return ContentService.createTextOutput('Error occurred: ' + error.toString());
  }
}

// Logs a message to the "DUMP" sheet of the active spreadsheet for debugging or data tracking purposes.
function logToDumpSheet(message) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DUMP');
    const timestamp = new Date();
    sheet.appendRow([timestamp, message]);
  } catch (error) {
    Logger.log('Error logging to DUMP sheet: ' + error.toString());
  }
}
