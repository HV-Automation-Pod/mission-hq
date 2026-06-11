function sendAlertToUser(errorMessage) {
    const url = 'https://slack.com/api/chat.postMessage';

    const payload = JSON.stringify({
        channel: ALERT_USER_ID,
        text: `⚠️ Alert: Failed to send Hyperfiesta Notion reminder to channel.\n\nError: ${errorMessage}`
    });

    const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        payload: payload,
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        Logger.log(`Alert sent to user ${ALERT_USER_ID}`);
    } catch (error) {
        Logger.log(`Failed to send alert: ${error.message}`);
    }
}

function sendHyperfiestaNotionReminder() {
    const url = 'https://slack.com/api/chat.postMessage';

    const payload = JSON.stringify({
        channel: REMINDER_CHANNEL_ID,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `📄 Please find the Notion document for Hyperfiesta <${HYPERFIESTA_NOTION_URL}|here>.`
                }
            }
        ]
    });

    const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        payload: payload,
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        const responseCode = response.getResponseCode();
        const jsonResponse = JSON.parse(response.getContentText());

        Logger.log(`HTTP response code: ${responseCode}`);
        // Logger.log(`API response: ${JSON.stringify(jsonResponse)}`);

        if (jsonResponse.ok) {
            const messageTimestamp = jsonResponse.ts;
            Logger.log(`Message sent successfully with timestamp ${messageTimestamp}`);
            return {
                success: true,
                ts: messageTimestamp,
                message: "Reminder message sent successfully"
            };
        } else {
            Logger.log(`Error sending message: ${jsonResponse.error}`);
            const errorMessage = `Error: ${jsonResponse.error}`;
            sendAlertToUser(errorMessage);
            return {
                success: false,
                message: errorMessage
            };
        }
    } catch (error) {
        Logger.log(`Exception occurred: ${error.message}`);
        const errorMessage = `Exception: ${error.message}`;
        sendAlertToUser(errorMessage);
        return {
            success: false,
            message: errorMessage
        };
    }
}
