function getConversation(channelId="CHANNEL_ID", threadTs="THREAD_TS") {
  var SLACK_TOKEN = SLACK_BOT_TOKEN;

  var url = "https://slack.com/api/conversations.replies";
  var payload = {
    channel: channelId,
    ts: threadTs
  };

  var options = {
    method: "post",
    headers: {
      "Authorization": "Bearer " + SLACK_TOKEN,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    payload: payload,
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());

  if (!data.ok) {
    Logger.log("Error fetching conversation: " + JSON.stringify(data));
    return;
  }

  // Helper to convert Slack ts → formatted datetime
  function formatTimestamp(ts) {
    var millis = parseInt(ts.split(".")[0], 10) * 1000;
    var date = new Date(millis);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd-MMMM-yyyy hh:mm a");
  }

  // Build structured dialogue
  var dialogue = data.messages.map(function(msg) {
    var fileNames = [];
    if (msg.files && msg.files.length > 0) {
      fileNames = msg.files.map(function(file) { return file.name; });
    }

    return {
      speaker: msg.user || "BOT",
      timestamp: msg.ts,
      datetime: formatTimestamp(msg.ts),
      message: msg.text || "",
      files: fileNames // will be [] if no files
    };
  });

  var conversation = {
    conversation_id: threadTs,
    channel: channelId,
    dialogue: dialogue
  };

  Logger.log(JSON.stringify(conversation, null, 2));
  return conversation;
}
