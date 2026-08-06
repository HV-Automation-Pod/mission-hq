// ============================================================================
// Slack error alerts — posts to the shared #automation-alerts channel when a
// MissionHQ trigger flow breaks, so silent failures get noticed. Same shape as
// the other HV automations:
//   sendErrorAlert(errorMessage, { functionName, sheetName, additionalInfo })
//
// Posts via the HV Automation bot (HV_AUTOMATION_BOT_TOKEN) — it is already a
// member of #automation-alerts — to ALERT_CHANNEL_ID. Deduped (identical alert
// suppressed for ALERT_COOLDOWN_MINUTES via the script cache) so a repeatedly-
// failing trigger can't spam the channel. No-ops if token/channel are unset, and
// never throws into the caller.
//
// Required Script Properties:
//   HV_AUTOMATION_BOT_TOKEN   (already set — used by the fortnightly summaries)
//   ALERT_CHANNEL_ID          #automation-alerts channel id
// ============================================================================

var ALERT_COOLDOWN_MINUTES = 30;

function sendErrorAlert(errorMessage, context) {
  context = context || {};
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('HV_AUTOMATION_BOT_TOKEN');
    const channel = props.getProperty('ALERT_CHANNEL_ID');
    if (!token || !channel) {
      Logger.log('sendErrorAlert: HV_AUTOMATION_BOT_TOKEN or ALERT_CHANNEL_ID not set — skipping.');
      return;
    }

    // Dedup on function + message so the same failure is sent at most once per cooldown.
    const cache = CacheService.getScriptCache();
    const cacheKey = 'mhq_alert_' + Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      (context.functionName || '') + '_' + errorMessage
    ).map(function (b) { return (b + 128).toString(16).slice(-2); }).join('');
    if (cache.get(cacheKey)) {
      Logger.log('Skipping duplicate alert (cooldown active): ' + errorMessage);
      return;
    }

    let details = '';
    if (context.functionName) details += '*Function:* `' + context.functionName + '`\n';
    if (context.sheetName) details += '*Sheet:* ' + context.sheetName + '\n';
    if (context.additionalInfo) details += '*Details:* ' + context.additionalInfo + '\n';

    const text = ':rotating_light: *MissionHQ Alert*\n\n' +
      '*Error:* `' + errorMessage + '`\n' + details;

    const resp = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ channel: channel, text: text, unfurl_links: false }),
      muteHttpExceptions: true,
    });
    const json = JSON.parse(resp.getContentText());
    if (!json.ok) {
      Logger.log('sendErrorAlert failed: ' + json.error);
    } else {
      cache.put(cacheKey, '1', ALERT_COOLDOWN_MINUTES * 60);
    }
  } catch (e) {
    Logger.log('sendErrorAlert threw: ' + (e && e.message ? e.message : e));
  }
}

// Run ONCE from the editor to verify the alert path (token + channel + bot
// membership). Posts a test message to #automation-alerts.
function testMissionHqAlert() {
  sendErrorAlert('Test alert — MissionHQ Slack alerting is wired up correctly. ✅', {
    functionName: 'testMissionHqAlert',
    additionalInfo: 'If you can read this in #automation-alerts, alerts are working.',
  });
}
