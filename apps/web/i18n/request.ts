import { getRequestConfig } from "next-intl/server";
import localeConfig from "./locales.json";

// Scaffolded for a single default `en` locale. The default message dictionary
// lives in `../messages/<locale>.json`. Adding a new locale later means:
//   1. add `<locale>.json` next to `en.json` and list it in `locales.json`
//   2. resolve the locale here (env var, user preference, etc.)
//   3. pass `locale="<locale>"` to <NextIntlClientProvider> in the root layout.
export default getRequestConfig(async () => {
  const locale = localeConfig.sourceLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
