const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email) => typeof email === "string" && EMAIL_RE.test(email.trim());
const isValidPassword = (password) => typeof password === "string" && password.length >= 8;
const isNonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

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

const VALID_CATEGORIES = ["quiz", "poll", "qa"];
const VALID_DIFFICULTIES = ["easy", "medium", "hard"];
const VALID_SESSION_STATUSES = ["draft", "active", "ended"];

module.exports = {
  isValidEmail,
  isValidPassword,
  isNonEmpty,
  validateRegister,
  validateLogin,
  VALID_CATEGORIES,
  VALID_DIFFICULTIES,
  VALID_SESSION_STATUSES,
};
