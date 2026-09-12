const { getQueue } = require("./queue");

const EMAIL_QUEUE_NAME = "email-queue";

const emailQueue = getQueue(EMAIL_QUEUE_NAME);

module.exports = { emailQueue, EMAIL_QUEUE_NAME };
