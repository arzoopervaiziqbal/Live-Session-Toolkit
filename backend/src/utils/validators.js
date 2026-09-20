const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Validates a registration payload, returns a map of field -> error message.
function validateRegister({ name, email, password, confirmPassword }) {
  const errors = {};
  if (!isNonEmpty(name)) errors.name = "Name is required.";
  if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
  if (!isValidPassword(password)) errors.password = "Password needs at least 8 characters.";
  if (confirmPassword !== undefined && password !== confirmPassword) {
    errors.confirmPassword = "Passwords don't match.";
  }
  return errors;
}

function validateLogin({ email, password }) {
  const errors = {};
  if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
  if (!isNonEmpty(password)) errors.password = "Password is required.";
  return errors;
}

module.exports = { isValidEmail, isValidPassword, isNonEmpty, validateRegister, validateLogin };
