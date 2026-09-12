const winston = require("winston");
const path = require("path");

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const logsDir = path.join(__dirname, "..", "logs");

// Human-readable format for local development
const devFormat = combine(
  colorize(),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[${ts}] ${level}: ${stack || message}${metaStr}`;
  })
);

// Structured JSON format for production (easier to ship to log aggregators)
const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  format: process.env.NODE_ENV === "production" ? prodFormat : devFormat,
  defaultMeta: { service: "doctor-appointment-api" },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logsDir, "error.log"), level: "error" }),
    new winston.transports.File({ filename: path.join(logsDir, "combined.log") }),
  ],
  exitOnError: false,
});

// Lets morgan (existing HTTP request logger) pipe its output through winston
// instead of writing directly to stdout, so all logs share one pipeline.
logger.stream = {
  write: (message) => logger.info(message.trim()),
};

module.exports = logger;
