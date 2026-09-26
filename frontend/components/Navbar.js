"use client";
import Link from "next/link";
import { useLang } from "../contexts/LangContext";
import SettingsMenu from "./SettingsMenu";

export default function Navbar({ user, userName, userEmail, onLogout, logoutLabel }) {
  const { t } = useLang();
  const displayName = user?.name || userName;
  const displayEmail = user?.email || userEmail;
  const isGoogle =
    user?.authProvider === "google" ||
    (displayEmail && displayEmail.toLowerCase().endsWith("@gmail.com"));
  const isPhone = user?.authProvider === "phone";

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[#E1E1DC] dark:border-[#2A2E52] bg-white dark:bg-[#171A33]">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-display font-bold text-sm">
          L
        </div>
        <div>
          <div className="font-display font-bold text-sm leading-tight">{t.appName}</div>
          <div className="text-[11px] text-gray-500 leading-tight">{t.tagline}</div>
        </div>
      </Link>

      <div className="flex items-center gap-3">
        {displayName && (
          <div className="flex items-center gap-2.5 bg-[#F5F5F2] dark:bg-[#0E1020] border border-[#E1E1DC] dark:border-[#2A2E52] rounded-xl px-3 py-1.5 text-xs shadow-xs">
            {isGoogle ? (
              <div
                className="w-7 h-7 rounded-full bg-white dark:bg-[#1B1E3F] border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0 shadow-xs"
                title={`Signed in with Google: ${displayEmail || displayName}`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              </div>
            ) : isPhone ? (
              <span className="text-base">📱</span>
            ) : (
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="flex flex-col text-left min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs leading-tight text-gray-900 dark:text-gray-100 truncate max-w-[130px] sm:max-w-[180px]">
                  {displayName}
                </span>
                {isGoogle && (
                  <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                    Google
                  </span>
                )}
              </div>
              {displayEmail && (
                <span
                  className="text-[10px] text-gray-500 dark:text-gray-400 font-mono leading-tight truncate max-w-[160px] sm:max-w-[220px]"
                  title={displayEmail}
                >
                  {displayEmail}
                </span>
              )}
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                title={logoutLabel || "Log out"}
                className="text-gray-400 hover:text-rose-500 text-xs p-1 ml-0.5 cursor-pointer transition-colors"
              >
                ⎋
              </button>
            )}
          </div>
        )}
        <SettingsMenu />
      </div>
    </div>
  );
}
