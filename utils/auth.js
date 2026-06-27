const jwt = require('jsonwebtoken');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET || 'green-lynk-secret';

const auth = async (req, res, next) => {
  try {
    const authorization = req.header('Authorization');
    if (!authorization) throw new Error('Authorization required');

    const token = authorization.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ _id: decoded._id, 'tokens.token': token });
    if (!user) throw new Error('Please authenticate');

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;
