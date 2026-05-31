const User = require('../models/User');

let webPush = null;

const getWebPush = () => {
  if (webPush !== null) return webPush;

  try {
    // Lazy load so the backend can still boot even if the dependency is not installed yet.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    webPush = require('web-push');
  } catch (error) {
    webPush = false;
  }

  return webPush;
};

const configureWebPush = () => {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  const client = getWebPush();

  if (!client || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return null;
  }

  client.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return client;
};

const sanitizeSubscription = (subscription) => {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    }
  };
};

const sendPushNotification = async (user, payload) => {
  const client = configureWebPush();
  if (!client || !user?.pushSubscriptions?.length) return;

  const serializedPayload = JSON.stringify(payload);
  const invalidEndpoints = [];

  await Promise.all(
    user.pushSubscriptions.map(async (subscription) => {
      const normalized = sanitizeSubscription(subscription);
      if (!normalized) return;

      try {
        await client.sendNotification(normalized, serializedPayload);
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          invalidEndpoints.push(normalized.endpoint);
          return;
        }

        console.error('Push notification failed:', error.message);
      }
    })
  );

  if (invalidEndpoints.length > 0) {
    await User.findByIdAndUpdate(user._id, {
      $pull: {
        pushSubscriptions: {
          endpoint: { $in: invalidEndpoints }
        }
      }
    });
  }
};

module.exports = {
  sanitizeSubscription,
  sendPushNotification
};
