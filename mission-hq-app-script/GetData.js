function getLocationsList() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOCATIONS_SHEET_NAME);
    if (!sheet) {
      throw new Error(`Sheet ${LOCATIONS_SHEET_NAME} not found`);
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(header => header.toString().trim());
    const locationColIndex = headers.indexOf("Locations");
    const valueColIndex = headers.indexOf("Value");

    if (locationColIndex === -1) {
      throw new Error(`"Locations" column not found in ${LOCATIONS_SHEET_NAME}`);
    }
    if (valueColIndex === -1) {
      throw new Error(`"Value" column not found in ${LOCATIONS_SHEET_NAME}`);
    }

    // Collect unique locations and their values
    const locations = [];
    const locationSet = new Set(); // To ensure uniqueness of locations
    for (let i = 1; i < data.length; i++) {
      const location = data[i][locationColIndex]?.toString().trim();
      const value = data[i][valueColIndex]?.toString().trim() || ""; // Handle empty or missing values
      if (location && !locationSet.has(location)) {
        locationSet.add(location);
        locations.push({ location, value });
      }
    }

    if (locations.length === 0) {
      throw new Error(`No valid locations found in ${LOCATIONS_SHEET_NAME}`);
    }

    Logger.log(`Retrieved ${locations.length} unique locations with values: ${JSON.stringify(locations)}`);
    return locations;

  } catch (error) {
    Logger.log(`Error processing sheet ${LOCATIONS_SHEET_NAME}: ${error.message}`);
    return []; // Return empty array on error to prevent breaking dependent functions
  }
}

function getUserInfoByEmail(email = 'user@example.com', token = SLACK_BOT_TOKEN) {
  Logger.log(email)
  const url = `https://slack.com/api/users.lookupByEmail?email=${email}`;
  const options = {
    'method': 'get',
    'headers': {
      'Authorization': `Bearer ${token}`
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(response.getContentText());

    if (data.ok) {
      Logger.log(data.user.id)
      return {
        id: data.user.id,
        name: data.user.real_name
      };
    } else {
      Logger.log('Error fetching user info: ' + data.error);
      return null;
    }
  } catch (error) {
    Logger.log('Error fetching user info: ' + error.toString());
    return null;
  }
}

function getValueByLocation(location = "🏢 Office – Full Day") {
  try {
    // Validate input
    if (!location || typeof location !== 'string' || location.trim() === "") {
      throw new Error("Invalid or empty location provided");
    }
    const trimmedLocation = location.trim();

    // Get sheet and data
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOCATIONS_SHEET_NAME);
    if (!sheet) {
      throw new Error(`Sheet ${LOCATIONS_SHEET_NAME} not found`);
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 1) {
      throw new Error(`No data found in ${LOCATIONS_SHEET_NAME}`);
    }

    // Get headers and column indices
    const headers = data[0].map(header => header.toString().trim());
    const locationColIndex = headers.indexOf("Locations");
    const valueColIndex = headers.indexOf("Value");

    if (locationColIndex === -1) {
      throw new Error(`"Locations" column not found in ${LOCATIONS_SHEET_NAME}`);
    }
    if (valueColIndex === -1) {
      throw new Error(`"Value" column not found in ${LOCATIONS_SHEET_NAME}`);
    }

    // Search for the location and return the corresponding value
    for (let i = 1; i < data.length; i++) {
      const currentLocation = data[i][locationColIndex]?.toString().trim();
      if (currentLocation === trimmedLocation) {
        const value = data[i][valueColIndex];
        if (value === undefined || value === null || value.toString().trim() === "") {
          throw new Error(`No valid value found for location "${trimmedLocation}"`);
        }
        // Logger.log(`Found value "${value}" for location "${trimmedLocation}"`);
        return value; // Return the value (string, number, etc.)
      }
    }

    throw new Error(`Location "${trimmedLocation}" not found in ${LOCATIONS_SHEET_NAME}`);

  } catch (error) {
    Logger.log(`Error in getValueByLocation: ${error.message}`);
    return null; // Return null on error to indicate failure
  }
}
