"use client";
import { useState, useEffect } from "react";
import { useLang } from "../contexts/LangContext";
import { api } from "../lib/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthForm({
  title,
  role = "host",
  onSubmit,
  onGoogleSubmit,
}) {
  const { t } = useLang();
  const isHost = role === "host";

  // Mode: 'login' | 'register'
  const [mode, setMode] = useState("login");

  // Email form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Google Modal state
  const [googleModalOpen, setGoogleModalOpen] = useState(false);
  const [googleEmail, setGoogleEmail] = useState("");
  const [googleName, setGoogleName] = useState("");
  const [savedGoogleAccounts, setSavedGoogleAccounts] = useState([]);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Load saved Google accounts on mount
  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem("sp_personal_google_email") || "";
      const savedName = localStorage.getItem("sp_personal_google_name") || "";
      const savedAccountsRaw = localStorage.getItem("sp_google_accounts");
      let list = [];
      if (savedAccountsRaw) {
        list = JSON.parse(savedAccountsRaw);
      } else if (savedEmail) {
        list = [{ email: savedEmail, name: savedName || savedEmail.split("@")[0] }];
      }
      setSavedGoogleAccounts(list);
      if (savedEmail) {
        setGoogleEmail(savedEmail);
        setGoogleName(savedName || savedEmail.split("@")[0]);
      }
    } catch (_) {}
  }, []);

  function clearError(field) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function switchMode(next) {
    setMode(next);
    setErrors({});
    setName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  }

  function validateEmailForm() {
    const errs = {};
    if (mode === "register" && !name.trim()) errs.name = "Enter your full name.";
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Password needs at least 8 characters.";
    if (mode === "register" && password !== confirmPassword)
      errs.confirmPassword = "Passwords don't match.";
    return errs;
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    const clientErrors = validateEmailForm();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      if (onSubmit) {
        await onSubmit(mode, {
          name: name.trim(),
          email: email.trim(),
          password,
          confirmPassword,
        });
      }
    } catch (err) {
      const apiErrors = err.body?.errors || { form: err.message };
      setErrors(apiErrors);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleConfirm(selectedAcc) {
    let rawEmail = (selectedAcc?.email || googleEmail).trim();
    let rawName = (selectedAcc?.name || googleName).trim();

    if (!rawEmail) {
      setErrors({ google: "Enter your Google email address." });
      return;
    }
    if (!rawEmail.includes("@")) rawEmail = `${rawEmail}@gmail.com`;
    if (!EMAIL_RE.test(rawEmail)) {
      setErrors({ google: "Enter a valid Google email address." });
      return;
    }

    const finalEmail = rawEmail.toLowerCase();
    const finalName = rawName || finalEmail.split("@")[0] || (isHost ? "Host" : "User");

    setGoogleSubmitting(true);
    setErrors({});
    try {
      try {
        localStorage.setItem("sp_personal_google_email", finalEmail);
        localStorage.setItem("sp_personal_google_name", finalName);
        const updated = [
          { email: finalEmail, name: finalName },
          ...(savedGoogleAccounts || []).filter((a) => a.email.toLowerCase() !== finalEmail),
        ].slice(0, 3);
        localStorage.setItem("sp_google_accounts", JSON.stringify(updated));
        setSavedGoogleAccounts(updated);
      } catch (_) {}

      const payload = { email: finalEmail, name: finalName, googleId: `google_${Date.now()}` };

      if (onGoogleSubmit) {
        await onGoogleSubmit(payload);
      } else {
        const fn = isHost ? api.hostGoogleLogin : api.participantGoogleLogin;
        await fn(payload);
      }
      setGoogleModalOpen(false);
    } catch (err) {
      const apiErrors = err.body?.errors || { google: err.message || "Google sign-in failed." };
      setErrors(apiErrors);
    } finally {
      setGoogleSubmitting(false);
    }
  }

  // ── SVG Icons ──────────────────────────────────────────────────────────────
  const IconEyeOpen = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
  const IconEyeOff = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    </svg>
  );
  const GoogleIcon = (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );

  return (
    <div className="w-full max-w-[400px] mx-auto">
      {/* ── Brand Header ─────────────────────────────────────────────────── */}
      <div className="text-center mb-3">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-primary to-indigo-600 text-white shadow-lg shadow-primary/25 mb-1.5 ring-4 ring-primary/10">
          {isHost ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
            </svg>
          )}
        </div>
        <h1 className="font-display font-extrabold text-lg text-slate-900 dark:text-white tracking-tight">
          {isHost ? "Host & Proctor Suite" : "Participant Portal"}
        </h1>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          Live Session Toolkit
        </p>
      </div>

      {/* ── Auth Card ────────────────────────────────────────────────────── */}
      <div className="card p-3.5 sm:p-4 bg-white/95 dark:bg-[#111328]/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/90 shadow-2xl shadow-indigo-950/5 dark:shadow-black/50 rounded-2xl">

        {/* Sign In / Create Account toggle */}
        <div className="grid grid-cols-2 p-0.5 bg-slate-100 dark:bg-slate-800/70 rounded-xl mb-3">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === "login"
                ? "bg-white dark:bg-[#1D203F] text-slate-900 dark:text-white shadow-xs"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              mode === "register"
                ? "bg-white dark:bg-[#1D203F] text-primary dark:text-indigo-300 shadow-xs"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* ── Google Sign-In ──────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => { setGoogleModalOpen(true); setErrors({}); }}
          className="w-full h-9 px-4 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-2.5 transition-all shadow-xs hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer active:scale-[0.99] mb-3"
        >
          {GoogleIcon}
          <span>{mode === "login" ? "Sign in with Google" : "Continue with Google"}</span>
        </button>

        {/* Divider */}
        <div className="relative mb-3">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
            <span className="bg-white dark:bg-[#111328] px-3 text-slate-400">or with email</span>
          </div>
        </div>

        {/* ── Email / Password Form ───────────────────────────────────── */}
        <form onSubmit={handleEmailSubmit} noValidate className="space-y-2">
          {/* Name (register only) */}
          {mode === "register" && (
            <div>
              <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 block mb-0.5">
                Full Name
              </label>
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                className={`w-full h-9 bg-slate-50/60 dark:bg-[#0C0E1F] border rounded-xl px-3 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                  errors.name ? "border-red-500" : "border-slate-200 dark:border-slate-700/80"
                }`}
                placeholder="Your full name"
                value={name}
                onChange={(e) => { setName(e.target.value); clearError("name"); }}
              />
              {errors.name && <p className="error-text text-[10px] mt-0.5">{errors.name}</p>}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 block mb-0.5">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              className={`w-full h-9 bg-slate-50/60 dark:bg-[#0C0E1F] border rounded-xl px-3 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                errors.email ? "border-red-500" : "border-slate-200 dark:border-slate-700/80"
              }`}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError("email"); }}
            />
            {errors.email && <p className="error-text text-[10px] mt-0.5">{errors.email}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 block mb-0.5">
              Password
            </label>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={`w-full h-9 bg-slate-50/60 dark:bg-[#0C0E1F] border rounded-xl px-3 pr-9 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                  errors.password ? "border-red-500" : "border-slate-200 dark:border-slate-700/80"
                }`}
                placeholder={mode === "login" ? "Your password" : "At least 8 characters"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearError("password"); }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                aria-label="Toggle password"
              >
                {showPassword ? IconEyeOff : IconEyeOpen}
              </button>
            </div>
            {errors.password && <p className="error-text text-[10px] mt-0.5">{errors.password}</p>}
          </div>

          {/* Confirm Password (register only) */}
          {mode === "register" && (
            <div>
              <label className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 block mb-0.5">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="auth-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={`w-full h-9 bg-slate-50/60 dark:bg-[#0C0E1F] border rounded-xl px-3 pr-9 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all ${
                    errors.confirmPassword ? "border-red-500" : "border-slate-200 dark:border-slate-700/80"
                  }`}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); clearError("confirmPassword"); }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                  aria-label="Toggle confirm password"
                >
                  {showConfirmPassword ? IconEyeOff : IconEyeOpen}
                </button>
              </div>
              {errors.confirmPassword && <p className="error-text text-[10px] mt-0.5">{errors.confirmPassword}</p>}
            </div>
          )}

          {/* Form-level error */}
          {errors.form && (
            <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium" role="alert">
              {errors.form}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-9 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:opacity-95 text-white font-semibold text-xs shadow-md shadow-primary/20 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span>Processing...</span>
              </>
            ) : mode === "login" ? (
              <span>Sign In</span>
            ) : (
              <span>Create Account</span>
            )}
          </button>
        </form>

        {/* Toggle footer */}
        <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
          {mode === "login" ? (
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              No account?{" "}
              <button type="button" onClick={() => switchMode("register")} className="font-bold text-primary dark:text-indigo-400 hover:underline cursor-pointer">
                Create one
              </button>
            </p>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              Have an account?{" "}
              <button type="button" onClick={() => switchMode("login")} className="font-bold text-primary dark:text-indigo-400 hover:underline cursor-pointer">
                Sign in
              </button>
            </p>
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1">
            <svg className="w-3 h-3 text-emerald-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd" />
            </svg>
            SSL Secure
          </span>
        </div>
      </div>

      {/* ── Google Sign-In Modal ─────────────────────────────────────────── */}
      {googleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card max-w-sm w-full p-5 bg-white dark:bg-[#12142B] border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                {GoogleIcon}
                <h3 className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                  {mode === "login" ? "Sign in with Google" : "Continue with Google"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setGoogleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Saved Accounts Quick Select */}
            {savedGoogleAccounts.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Saved Accounts
                </p>
                <div className="space-y-1.5">
                  {savedGoogleAccounts.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => handleGoogleConfirm(acc)}
                      className="w-full text-left p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 hover:border-primary/50 bg-slate-50/50 dark:bg-[#161833] flex items-center gap-2.5 transition-all cursor-pointer group"
                    >
                      <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-primary to-indigo-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        {acc.name ? acc.name[0].toUpperCase() : "G"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-primary transition-colors">
                          {acc.name || "Google User"}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">{acc.email}</p>
                      </div>
                      <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-primary shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-slate-800" /></div>
                  <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                    <span className="bg-white dark:bg-[#12142B] px-2 text-slate-400">or use another</span>
                  </div>
                </div>
              </div>
            )}

            {/* Email + Name inputs */}
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Google Email
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  className="w-full h-10 bg-slate-50/60 dark:bg-[#0E1020] border border-slate-200 dark:border-slate-700 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  placeholder="name@gmail.com"
                  value={googleEmail}
                  onChange={(e) => { setGoogleEmail(e.target.value); clearError("google"); }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  autoComplete="name"
                  className="w-full h-10 bg-slate-50/60 dark:bg-[#0E1020] border border-slate-200 dark:border-slate-700 rounded-xl px-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  placeholder="Your name"
                  value={googleName}
                  onChange={(e) => { setGoogleName(e.target.value); clearError("google"); }}
                />
              </div>
            </div>

            {errors.google && (
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs mb-3 font-medium" role="alert">
                {errors.google}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={googleSubmitting || !googleEmail.trim()}
                onClick={() => handleGoogleConfirm()}
                className="flex-1 h-10 rounded-xl bg-gradient-to-r from-primary to-indigo-600 hover:opacity-95 text-white font-semibold text-sm shadow-md shadow-primary/20 cursor-pointer disabled:opacity-50 transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                {googleSubmitting ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Continue</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setGoogleModalOpen(false)}
                className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
