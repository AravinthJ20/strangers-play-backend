const createMailTransport = () => {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    return null;
  }

  const nodemailer = require('nodemailer');

  return nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort),
    secure: Number(smtpPort) === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass
    },
    tls: process.env.SMTP_ALLOW_SELF_SIGNED === 'true'
      ? { rejectUnauthorized: false }
      : undefined
  });
};

const sendMail = async ({ to, subject, text, html }) => {
  const transport = createMailTransport();
  if (!transport) {
    return { delivered: false };
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });

  return { delivered: true };
};

module.exports = {
  createMailTransport,
  sendMail
};
