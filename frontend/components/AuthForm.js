"use client";
import { useState } from "react";
import { useLang } from "../contexts/LangContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared login/register form used by both host and participant auth pages.
// onSubmit(mode, { name, email, password }) should throw an object with
// { errors: { field: message } } on failure (matching the API's error shape).
export default function AuthForm({ title, onSubmit }) {
  const { t } = useLang();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  function clearError(field) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function switchMode(next) {
    setMode(next);
    setErrors({});
    setPassword("");
    setConfirmPassword("");
  }

  function validateClientSide() {
    const errs = {};
    if (mode === "register" && !name.trim()) errs.name = "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Password needs at least 8 characters.";
    if (mode === "register" && password !== confirmPassword) errs.confirmPassword = "Passwords don't match.";
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const clientErrors = validateClientSide();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(mode, { name: name.trim(), email: email.trim(), password, confirmPassword });
    } catch (err) {
      const apiErrors = err.body?.errors || { form: err.message };
      setErrors(apiErrors);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm w-full mx-auto">
      <h1 className="font-display text-xl font-bold text-center mb-5">{title}</h1>

      <div className="flex bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg p-1 border border-[#E1E1DC] dark:border-[#2A2E52] mb-6">
        <button
          type="button"
          onClick={() => switchMode("login")}
          className={`flex-1 text-xs py-2 rounded-md ${mode === "login" ? "bg-primary text-white" : "text-gray-500"}`}
        >
          {t.tab_login}
        </button>
        <button
          type="button"
          onClick={() => switchMode("register")}
          className={`flex-1 text-xs py-2 rounded-md ${mode === "register" ? "bg-primary text-white" : "text-gray-500"}`}
        >
          {t.tab_register}
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {mode === "register" && (
          <div className="mb-4">
            <label className="label">{t.name_label}</label>
            <input
              className={`field ${errors.name ? "field-error" : ""}`}
              placeholder={t.name_placeholder}
              value={name}
              aria-invalid={!!errors.name}
              onChange={(e) => {
                setName(e.target.value);
                clearError("name");
              }}
            />
            {errors.name && <div className="error-text" role="alert">{errors.name}</div>}
          </div>
        )}

        <div className="mb-4">
          <label className="label">{t.email_label}</label>
          <input
            type="email"
            className={`field ${errors.email ? "field-error" : ""}`}
            placeholder={t.email_placeholder}
            value={email}
            aria-invalid={!!errors.email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError("email");
            }}
          />
          {errors.email && <div className="error-text" role="alert">{errors.email}</div>}
        </div>

        <div className="mb-4">
          <label className="label">{t.password_label}</label>
          <input
            type="password"
            className={`field ${errors.password ? "field-error" : ""}`}
            placeholder={t.password_placeholder}
            value={password}
            aria-invalid={!!errors.password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError("password");
            }}
          />
          {errors.password && <div className="error-text" role="alert">{errors.password}</div>}
        </div>

        {mode === "register" && (
          <div className="mb-4">
            <label className="label">{t.confirm_password_label}</label>
            <input
              type="password"
              className={`field ${errors.confirmPassword ? "field-error" : ""}`}
              placeholder={t.confirm_password_placeholder}
              value={confirmPassword}
              aria-invalid={!!errors.confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                clearError("confirmPassword");
              }}
            />
            {errors.confirmPassword && <div className="error-text" role="alert">{errors.confirmPassword}</div>}
          </div>
        )}

        {errors.form && (
          <div className="form-error mb-4" role="alert">
            {errors.form}
          </div>
        )}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {mode === "login" ? t.login_btn : t.register_btn}
        </button>
      </form>

      <button
        type="button"
        onClick={() => switchMode(mode === "login" ? "register" : "login")}
        className="text-xs text-gray-500 w-full text-center mt-4"
      >
        {mode === "login" ? t.switch_to_register : t.switch_to_login}
      </button>
    </div>
  );
}
