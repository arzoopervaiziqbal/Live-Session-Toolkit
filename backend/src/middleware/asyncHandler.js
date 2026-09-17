// Express 4 does not forward rejected promises to the error handler.
// Wrapping every async controller keeps one try/catch instead of dozens.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
