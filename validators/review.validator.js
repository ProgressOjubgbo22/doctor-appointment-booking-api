const { z } = require("zod");

const createReviewSchema = z.object({
  appointmentId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

const updateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
});

module.exports = { createReviewSchema, updateReviewSchema };
