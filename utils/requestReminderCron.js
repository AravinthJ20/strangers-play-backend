const cron = require('node-cron');
const User = require('../models/User');
const { sendPushNotification } = require('./push');
const { sendMail } = require('./mail');

const REMINDER_SCHEDULE = process.env.CONNECTION_REQUEST_REMINDER_CRON || '0 10 * * *';
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const buildReminderCopy = (requestCount) => {
  const peopleLabel = requestCount === 1 ? 'person is' : 'people are';
  const requestsLabel = requestCount === 1 ? 'request' : 'requests';

  return {
    title: 'People are interested in your profile',
    body: `${requestCount} ${peopleLabel} interested in your profile. Please make a decision.`,
    emailSubject: `You have ${requestCount} pending interest ${requestsLabel}`,
    emailText: `${requestCount} ${peopleLabel} interested in your profile on Strangers Play. Please make a decision on the pending ${requestsLabel}.`,
    emailHtml: `
      <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#14213d">
        <h2 style="margin-bottom:12px;">People are interested in your profile</h2>
        <p>${requestCount} ${peopleLabel} interested in your profile on Strangers Play.</p>
        <p>Please open the app and make a decision on the pending ${requestsLabel}.</p>
      </div>
    `
  };
};

const shouldSendReminder = (user) => {
  if (!Array.isArray(user.connectionRequestsReceived) || user.connectionRequestsReceived.length === 0) {
    return false;
  }

  if (!user.lastConnectionDecisionReminderAt) {
    return true;
  }

  return Date.now() - new Date(user.lastConnectionDecisionReminderAt).getTime() >= REMINDER_COOLDOWN_MS;
};

const runRequestReminderJob = async () => {
  try {
    const users = await User.find({
      connectionRequestsReceived: { $exists: true, $ne: [] }
    }).select('username email connectionRequestsReceived lastConnectionDecisionReminderAt pushSubscriptions');

    for (const user of users) {
      if (!shouldSendReminder(user)) {
        continue;
      }

      const requestCount = user.connectionRequestsReceived.length;
      const reminderCopy = buildReminderCopy(requestCount);

      await sendPushNotification(user, {
        title: reminderCopy.title,
        body: reminderCopy.body,
        type: 'connection-request-reminder',
        requestCount
      });

      await sendMail({
        to: user.email,
        subject: reminderCopy.emailSubject,
        text: reminderCopy.emailText,
        html: reminderCopy.emailHtml
      });

      user.lastConnectionDecisionReminderAt = new Date();
      await user.save();
    }
  } catch (error) {
    console.error('Connection request reminder cron failed:', error.message);
  }
};

const startRequestReminderCron = () => {
  cron.schedule(REMINDER_SCHEDULE, () => {
    void runRequestReminderJob();
  });

  console.log(`Connection request reminder cron started with schedule "${REMINDER_SCHEDULE}"`);
};

module.exports = {
  startRequestReminderCron,
  runRequestReminderJob
};
