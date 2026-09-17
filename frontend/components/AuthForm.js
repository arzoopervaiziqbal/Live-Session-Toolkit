"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken, setUser } from "../lib/api";
import SettingsMenu from "./SettingsMenu";

export default function AuthForm({ mode = "login" }) {
  const router = useRouter();
  const isRegister = mode === "register";

  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear the error as soon as they start fixing it, rather than making them
    // resubmit to find out whether it's resolved.
    if (errors[field]) setErrors((e) => ({ ...e, [field]: null }));
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});

    try {
      const data = isRegister ? await api.register(form) : await api.login(form);
      setToken(data.token);
      setUser(data.user);
      router.replace("/host/dashboard");
    } catch (err) {
      setErrors(err.fieldErrors || { form: err.message });
    } finally {
      setBusy(false);
    }
  }

  const field = (name, label, type = "text", placeholder = "") => (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        type={type}
        className={`field ${errors[name] ? "field-error" : ""}`}
        value={form[name]}
        placeholder={placeholder}
        autoComplete={
          name === "password" ? (isRegister ? "new-password" : "current-password") : name === "email" ? "email" : "off"
        }
        onChange={(e) => update(name, e.target.value)}
      />
      {errors[name] && <div className="error-text">{errors[name]}</div>}
    </div>
  );

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-display font-bold text-sm">
            L
          </div>
          <div className="font-display font-bold">LiveHub</div>
        </Link>
        <SettingsMenu />
      </div>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <form onSubmit={submit} className="card p-6 w-full max-w-sm">
          <h1 className="font-display text-xl font-bold mb-1">
            {isRegister ? "Create your host account" : "Log in as host"}
          </h1>
          <p className="text-xs text-gray-500 mb-5">
            Participants don&apos;t need an account — they join with a code.
          </p>

          {errors.form && <div className="form-error mb-4">{errors.form}</div>}

          <div className="grid gap-3.5">
            {isRegister && field("name", "Full name", "text", "e.g. Jordan Ali")}
            {field("email", "Email", "email", "you@example.com")}
            {field("password", "Password", "password", "At least 8 characters")}
            {isRegister && field("confirmPassword", "Confirm password", "password", "Re-enter your password")}
          </div>

          <button className="btn-primary w-full mt-5" disabled={busy}>
            {busy ? "Please wait..." : isRegister ? "Create account" : "Log in"}
          </button>

          <div className="text-center mt-4">
            <Link
              href={isRegister ? "/host/login" : "/host/register"}
              className="text-xs text-primary hover:underline"
            >
              {isRegister ? "Already have an account? Log in" : "New here? Create an account"}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
