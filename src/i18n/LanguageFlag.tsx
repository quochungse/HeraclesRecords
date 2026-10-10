import type { Locale } from "./locales.ts";
import gb from "../assets/flags/gb.svg";
import vn from "../assets/flags/vn.svg";
import jp from "../assets/flags/jp.svg";
import kr from "../assets/flags/kr.svg";
import cn from "../assets/flags/cn.svg";
import es from "../assets/flags/es.svg";
import fr from "../assets/flags/fr.svg";
import de from "../assets/flags/de.svg";
import br from "../assets/flags/br.svg";
import it from "../assets/flags/it.svg";
import ru from "../assets/flags/ru.svg";
import id from "../assets/flags/id.svg";
import th from "../assets/flags/th.svg";

/**
 * The flag beside each language in Settings. SVG files from flag-icons (MIT,
 * `src/assets/flags`), committed like the fonts so a build never fetches them;
 * an emoji flag would have been lighter, but Windows draws those as two
 * letters. A flag stands for a country and a language is spoken in many, so it
 * is decoration beside the language's own name and never the name itself.
 */
const FLAGS: Record<Locale, string> = {
  en: gb,
  vi: vn,
  ja: jp,
  ko: kr,
  zh: cn,
  es,
  pt: br,
  fr,
  de,
  it,
  ru,
  id,
  th,
};

export function LanguageFlag({ locale }: { locale: Locale }) {
  return (
    <img
      className="language-flag"
      src={FLAGS[locale]}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
