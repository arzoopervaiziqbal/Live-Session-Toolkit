"use client";
import { createContext, useContext, useEffect, useState } from "react";
import en from "../locales/en";
import ur from "../locales/ur";
import es from "../locales/es";

const DICTS = { en, ur, es };
export const LANG_OPTIONS = [
  { code: "en", label: "English" },
  { code: "ur", label: "اردو" },
  { code: "es", label: "Español" },
];

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState("en");

  useEffect(() => {
    const stored = localStorage.getItem("sp_lang");
    if (stored && DICTS[stored]) setLang(stored);
  }, []);

  useEffect(() => {
    localStorage.setItem("sp_lang", lang);
  }, [lang]);

  const t = DICTS[lang];

  return (
    <LangContext.Provider value={{ lang, setLang, t, langLabel: LANG_OPTIONS.find((l) => l.code === lang).label }}>
      <div dir={t.dir}>{children}</div>
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
