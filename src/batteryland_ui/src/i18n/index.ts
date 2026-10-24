import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import { LANGUAGES, type Language } from "@/i18n/languages"
import { messagesEn, messagesZh } from "@/i18n/messages"

const STORAGE_KEY = "batteryland.language"

function initialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "zh-CN") {
    return stored
  }
  return "zh-CN"
}

export const translations = {
  "zh-CN": { translation: messagesZh },
  en: { translation: messagesEn },
}

void i18n.use(initReactI18next).init({
  resources: translations,
  lng: initialLanguage(),
  fallbackLng: "zh-CN",
  supportedLngs: LANGUAGES.map((language) => language.value),
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
})

export function applyDocumentLanguage(language: string): void {
  document.documentElement.lang = language
}

applyDocumentLanguage(i18n.language)
i18n.on("languageChanged", (language) => {
  localStorage.setItem(STORAGE_KEY, language)
  applyDocumentLanguage(language)
})

export default i18n
