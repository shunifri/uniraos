import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import zh, { type Translations } from './zh';
import en from './en';

export type Lang = 'zh' | 'en';

const messages: Record<Lang, Translations> = { zh, en };

type TranslationKey = keyof Translations;

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      lang: 'zh',
      setLang: (lang: Lang) => set({ lang }),
      t: (key: TranslationKey): string => {
        const lang = get().lang;
        return messages[lang][key] ?? key;
      },
    }),
    {
      name: 'raos-lang',
      partialize: (state) => ({ lang: state.lang }),
    },
  ),
);

export function useI18n() {
  const { lang, setLang, t } = useI18nStore();
  return { t, lang, setLang };
}

export { useI18nStore };
export type { Translations, TranslationKey };
