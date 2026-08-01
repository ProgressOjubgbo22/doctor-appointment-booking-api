const ApiError = require("../utils/ApiError");

// Usage: validate(schema) where schema is a Zod schema validating req.body (or req.query)
const validate = (schema, source = "body") => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return next(new ApiError(422, "Validation failed", errors));
  }
  req[source] = result.data;
  next();
};

module.exports = validate;
