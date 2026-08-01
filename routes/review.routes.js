const express = require("express");

const reviewController = require("../controllers/review.controller");
const verifyJWT = require("../middleware/auth.middleware");
const authorizeRoles = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const { createReviewSchema, updateReviewSchema } = require("../validators/review.validator");
const { z } = require("zod");

const router = express.Router();

router.get("/", reviewController.getReviews); // public
router.post("/", verifyJWT, authorizeRoles("patient"), validate(createReviewSchema), reviewController.createReview);
router.patch("/:id", verifyJWT, authorizeRoles("patient"), validate(updateReviewSchema), reviewController.updateReview);
router.delete("/:id", verifyJWT, authorizeRoles("patient", "admin"), reviewController.deleteReview);
router.patch(
  "/:id/moderate",
  verifyJWT,
  authorizeRoles("admin"),
  validate(z.object({ isApproved: z.boolean() })),
  reviewController.moderateReview
);

module.exports = router;
