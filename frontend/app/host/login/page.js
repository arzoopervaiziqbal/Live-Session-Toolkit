"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthForm from "../../../components/AuthForm";
import SettingsMenu from "../../../components/SettingsMenu";
import { useLang } from "../../../contexts/LangContext";
import { api, setToken, setUser } from "../../../lib/api";

export default function HostAuthPage() {
  const router = useRouter();
  const { t } = useLang();

  async function handleSubmit(mode, { name, email, password, confirmPassword }) {
    const data =
      mode === "login"
        ? await api.hostLogin({ email, password })
        : await api.hostRegister({ name, email, password, confirmPassword });
    setToken("host", data.token);
    setUser("host", data.user);
    router.push("/host/dashboard");
  }

  async function handleGoogleSubmit(googleData) {
    const data = await api.hostGoogleLogin(googleData);
    setToken("host", data.token);
    setUser("host", data.user);
    router.push("/host/dashboard");
  }

  return (
    /* ── Root: locked to viewport, no scroll ── */
    <div className="h-screen min-h-screen max-h-screen flex flex-col overflow-hidden bg-[#F8F9FA] dark:bg-[#0A0C1A] relative">
      {/* ── Decorative background (confined with overflow-hidden to prevent document scroll) ── */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e2238_1px,transparent_1px)] [background-size:24px_24px] opacity-50" />
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      {/* ── Navbar ── */}
      <header className="relative z-10 flex-none flex items-center justify-between px-5 py-2.5 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/60 dark:bg-[#0A0C1A]/60 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-primary to-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-sm shadow-primary/30 group-hover:scale-105 transition-transform">
            L
          </div>
          <div className="leading-tight">
            <span className="block font-bold text-xs text-slate-900 dark:text-slate-100">
              Live Session Toolkit
            </span>
            <span className="block text-[10px] text-slate-500">Host Portal</span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/participant/login"
            className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-primary dark:hover:text-indigo-400 py-1 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary/40 bg-white/70 dark:bg-white/5 transition-all"
          >
            Student Portal →
          </Link>
          <SettingsMenu />
        </div>
      </header>

      {/* ── Main: fills remaining space, centers the card ── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 overflow-hidden">
        <AuthForm
          role="host"
          title={t.asHost}
          onSubmit={handleSubmit}
          onGoogleSubmit={handleGoogleSubmit}
        />
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 flex-none flex items-center justify-center gap-3 py-2 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-200/50 dark:border-slate-800/50 bg-white/40 dark:bg-[#0A0C1A]/40 backdrop-blur-sm">
        <span>Live Session Toolkit</span>
        <span className="opacity-40">•</span>
        <span>Alkhidmat Foundation</span>
        <span className="opacity-40">•</span>
        <span className="flex items-center gap-1 text-emerald-500 dark:text-emerald-400 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Online
        </span>
      </footer>
    </div>
  );
}
