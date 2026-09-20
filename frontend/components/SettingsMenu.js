"use client";
import { useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useLang, LANG_OPTIONS } from "../contexts/LangContext";

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useLang();

  return (
    <div className="relative">
      <button className="btn-secondary" onClick={() => setOpen((o) => !o)}>
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 card p-4 shadow-lg z-20">
          <div className="flex justify-between items-center mb-3">
            <span className="font-display text-sm font-semibold">{t.settings_title}</span>
            <button onClick={() => setOpen(false)} className="text-xs text-gray-400">
              ✕
            </button>
          </div>

          <div className="mb-4">
            <div className="flex bg-[#F5F5F2] dark:bg-[#0E1020] rounded-lg p-1 border border-[#E1E1DC] dark:border-[#2A2E52]">
              {["light", "dark"].map((k) => (
                <button
                  key={k}
                  onClick={() => setTheme(k)}
                  className={`flex-1 text-xs py-2 rounded-md ${theme === k ? "bg-primary text-white" : "text-gray-500"}`}
                >
                  {k === "light" ? t.theme_light : t.theme_dark}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label">{t.language_label}</div>
            <div className="grid gap-1.5">
              {LANG_OPTIONS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`text-sm text-left px-3 py-2 rounded-md border ${
                    lang === l.code ? "border-primary bg-primary/10" : "border-[#E1E1DC] dark:border-[#2A2E52]"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
