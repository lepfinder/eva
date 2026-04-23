import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import zh from './locales/zh.json'

const savedLanguage = localStorage.getItem('devdash-language') || 'zh'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh }
  },
  lng: savedLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

export default i18n

export function changeLanguage(lang: string): void {
  localStorage.setItem('devdash-language', lang)
  i18n.changeLanguage(lang)
}

export function getCurrentLanguage(): string {
  return i18n.language
}


