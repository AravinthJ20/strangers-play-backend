const User = require('../models/User');
const VerificationOtp = require('../models/VerificationOtp');
const jwt = require('jsonwebtoken');
const { frontendUrl, inviteSecret, jwtSecret } = require('../config/env');
const { createMailTransport } = require('../utils/mail');

const createToken = (id) => jwt.sign({ _id: id.toString() }, jwtSecret, { expiresIn: '30d' });
const createInviteToken = ({ inviterId, inviterName, email }) =>
  jwt.sign({ inviterId, inviterName, email }, inviteSecret, { expiresIn: '7d' });

const decodeInviteToken = (inviteToken) => jwt.verify(inviteToken, inviteSecret);
const createOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;
const OTP_EXPIRY_MINUTES = 10;

const sendOtpEmail = async ({ email, subject, headline, body, otp }) => {
  const transport = createMailTransport();
  console.log(`OTP for ${email}: ${otp}`);

  if (!transport) {
    return { delivered: false };
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject,
    text: `${body}\nOTP: ${otp}\nThis OTP expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#14213d">
        <h2 style="margin-bottom:12px;">${headline}</h2>
        <p>${body}</p>
        <div style="display:inline-block;padding:14px 18px;border-radius:14px;background:#edf6f9;border:1px solid #dfe9ee;font-size:28px;font-weight:800;letter-spacing:0.22em;">
          ${otp}
        </div>
        <p style="margin-top:14px;">This OTP expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
      </div>
    `
  });

  return { delivered: true };
};

const sanitizeUser = (user) => {
  const userData = user.toObject();
  delete userData.password;
  delete userData.tokens;
  return userData;
};

exports.requestRegistrationOtp = async (req, res) => {
  try {
    const { username, email, password, inviteToken } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let invitePayload = null;
    if (inviteToken) {
      invitePayload = decodeInviteToken(inviteToken);
      if (invitePayload.email.toLowerCase() !== normalizedEmail) {
        return res.status(400).json({ error: 'Invite email does not match registration email' });
      }
    }

    const existing = await User.findOne({ $or: [{ username: username.trim() }, { email: normalizedEmail }] });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const otp = createOtp();
    await VerificationOtp.deleteMany({ purpose: 'register', email: normalizedEmail });
    await VerificationOtp.create({
      purpose: 'register',
      email: normalizedEmail,
      otp,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      payload: {
        username: username.trim(),
        password,
        inviteToken: inviteToken || ''
      }
    });

    const mailStatus = await sendOtpEmail({
      email: normalizedEmail,
      subject: 'Your Strangers Play registration OTP',
      headline: 'Verify your email to create your account',
      body: 'Use this one-time password to complete your Strangers Play registration.',
      otp
    });

    res.json({
      message: mailStatus.delivered
        ? 'OTP sent to your email'
        : 'OTP generated. Email delivery is not configured, so check the server console for the OTP.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to send registration OTP' });
  }
};

exports.register = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const normalizedEmail = email.toLowerCase().trim();
    const verification = await VerificationOtp.findOne({ purpose: 'register', email: normalizedEmail, otp });
    if (!verification || verification.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP is invalid or expired' });
    }

    const { username, password, inviteToken } = verification.payload;
    let invitePayload = null;
    if (inviteToken) {
      invitePayload = decodeInviteToken(inviteToken);
      if (invitePayload.email.toLowerCase() !== normalizedEmail) {
        return res.status(400).json({ error: 'Invite email does not match registration email' });
      }
    }

    const existing = await User.findOne({ $or: [{ username }, { email: normalizedEmail }] });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const user = new User({ username, email: normalizedEmail, password });
    const token = createToken(user._id);
    user.tokens = [{ token }];
    await user.save();
    await VerificationOtp.deleteMany({ purpose: 'register', email: normalizedEmail });

    if (invitePayload?.inviterId) {
      const inviter = await User.findById(invitePayload.inviterId);
      if (inviter && inviter._id.toString() !== user._id.toString()) {
        if (!inviter.connections.some((entry) => entry.toString() === user._id.toString())) {
          inviter.connections.push(user._id);
        }
        if (!user.connections.some((entry) => entry.toString() === inviter._id.toString())) {
          user.connections.push(inviter._id);
        }
        inviter.connectionRequestsSent = inviter.connectionRequestsSent.filter((entry) => entry.toString() !== user._id.toString());
        inviter.connectionRequestsReceived = inviter.connectionRequestsReceived.filter((entry) => entry.toString() !== user._id.toString());
        user.connectionRequestsSent = user.connectionRequestsSent.filter((entry) => entry.toString() !== inviter._id.toString());
        user.connectionRequestsReceived = user.connectionRequestsReceived.filter((entry) => entry.toString() !== inviter._id.toString());
        await Promise.all([inviter.save(), user.save()]);
      }
    }

    res.status(201).json({ user: sanitizeUser(user), token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = createToken(user._id);
    user.tokens.push({ token });
    await user.save();

    res.json({ user: sanitizeUser(user), token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.logout = async (req, res) => {
  try {
    req.user.tokens = req.user.tokens.filter((entry) => entry.token !== req.token);
    await req.user.save();
    res.json({ message: 'Logged out' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMe = async (req, res) => {
  res.json(sanitizeUser(req.user));
};

exports.sendInvite = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'That email is already registered' });
    }

    const inviteToken = createInviteToken({
      inviterId: req.user._id.toString(),
      inviterName: req.user.username,
      email: normalizedEmail
    });
    const inviteLink = `${frontendUrl}/register?invite=${encodeURIComponent(inviteToken)}`;
    const transport = createMailTransport();
    if (!transport) {
      return res.status(500).json({ error: 'Invite email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.' });
    }

    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: normalizedEmail,
      subject: `${req.user.username} invited you to join Strangers Play`,
      text: `${req.user.username} invited you to join Strangers Play. Register here: ${inviteLink}`,
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#14213d">
          <h2 style="margin-bottom:12px;">You are invited to Strangers Play</h2>
          <p><strong>${req.user.username}</strong> invited you to join and connect.</p>
          <p>
            <a href="${inviteLink}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2a9d8f;color:#ffffff;text-decoration:none;">
              Register Now
            </a>
          </p>
          <p>If the button does not work, use this link:</p>
          <p><a href="${inviteLink}">${inviteLink}</a></p>
        </div>
      `
    });

    res.json({ message: 'Invite sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to send invite' });
  }
};

exports.requestPasswordResetOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ error: 'No account found for this email' });

    const otp = createOtp();
    await VerificationOtp.deleteMany({ purpose: 'reset-password', email: normalizedEmail });
    await VerificationOtp.create({
      purpose: 'reset-password',
      email: normalizedEmail,
      otp,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
    });

    const mailStatus = await sendOtpEmail({
      email: normalizedEmail,
      subject: 'Your Strangers Play password reset OTP',
      headline: 'Reset your Strangers Play password',
      body: 'Use this one-time password to continue resetting your password.',
      otp
    });

    res.json({
      message: mailStatus.delivered
        ? 'Password reset OTP sent to your email'
        : 'Password reset OTP generated. Email delivery is not configured, so check the server console for the OTP.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to send reset OTP' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const verification = await VerificationOtp.findOne({ purpose: 'reset-password', email: normalizedEmail, otp });
    if (!verification || verification.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP is invalid or expired' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.password = password;
    user.tokens = [];
    await user.save();
    await VerificationOtp.deleteMany({ purpose: 'reset-password', email: normalizedEmail });

    res.json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to reset password' });
  }
};

exports.validateInvite = async (req, res) => {
  try {
    const invite = decodeInviteToken(req.params.inviteToken);
    res.json({
      email: invite.email,
      inviterName: invite.inviterName,
      inviterId: invite.inviterId
    });
  } catch (error) {
    res.status(400).json({ error: 'Invite link is invalid or expired' });
  }
};
