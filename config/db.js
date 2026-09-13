const mongoose = require("mongoose");
logger.info(`MongoDB connected: ${conn.connection.host}`);


const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    logger.info(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    logger.info(`MongoDB connected: ${conn.connection.host}`);
    process.exit(1);
  }
};

module.exports = connectDB;
