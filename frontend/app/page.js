"use client";
import Link from "next/link";
import { useLang } from "../contexts/LangContext";
import SettingsMenu from "../components/SettingsMenu";

export default function LandingPage() {
  const { t } = useLang();
  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-display font-bold text-sm">
            L
          </div>
          <div className="font-display font-bold">{t.appName}</div>
        </div>
        <SettingsMenu />
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <h1 className="font-display text-2xl font-bold mb-2">{t.appName}</h1>
          <p className="text-sm text-gray-500 mb-8">{t.chooseRole}</p>

          <div className="grid gap-3">
            <Link href="/host/login" className="card p-5 text-left hover:border-primary transition-colors">
              <div className="font-display font-semibold mb-1">{t.asHost}</div>
              <div className="text-xs text-gray-500">{t.asHostDesc}</div>
            </Link>
            <Link href="/participant/join" className="card p-5 text-left hover:border-primary transition-colors">
              <div className="font-display font-semibold mb-1">{t.asParticipant}</div>
              <div className="text-xs text-gray-500">No account needed — just enter your name and session code</div>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
