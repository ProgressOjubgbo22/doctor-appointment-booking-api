const { z } = require("zod");

const sendMessageSchema = z.object({
  message: z.string().min(1, "Message can't be empty").max(5000),
});

module.exports = { sendMessageSchema };
