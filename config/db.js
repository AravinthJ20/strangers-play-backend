const mongoose = require('mongoose');

const connectDB = async () => {
  try {
const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/green-lynk';
    await mongoose.connect(uri);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed', error);
    process.exit(1);
  }
};

module.exports = connectDB;
