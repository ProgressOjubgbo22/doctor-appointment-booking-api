require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const logger = require("./config/logger");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`Hospital Appointment System API running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
  });

  process.on("unhandledRejection", (err) => {
    logger.error("Unhandled Rejection", { error: err.message, stack: err.stack });
    server.close(() => process.exit(1));
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught Exception", { error: err.message, stack: err.stack });
    server.close(() => process.exit(1));
  });

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received. Shutting down gracefully.");
    server.close(() => process.exit(0));
  });
};

startServer();
