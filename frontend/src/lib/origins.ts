/**
 * The words in a quote that name where the matcha comes from.
 *
 * Mirrors the vocabulary TransparencyGrader grades on (backend
 * TransparencyGrader.java: JAPANESE_ORIGINS, COMPOUND_ORIGIN, JAPANESE_PRODUCER),
 * so what the page marks is exactly what earned the cafe its A — a region, a
 * compound like "Ujicha", or a named Japanese producer. "Japan" alone is not
 * here, for the same reason it is not an A in the grader. Keep the two in step.
 */
const REGIONS = [
  "uji", "nishio", "kagoshima", "yame", "shizuoka", "kyoto", "fukuoka",
  "aichi", "wazuka", "kirishima", "miyazaki", "sayama", "saitama",
  "asahina", "chiran", "hoshino", "honyama", "kawane", "makinohara",
  "obubu", "yakushima", "kumamoto", "shirakawa", "tsukigase", "okabe",
  "izumo", "yanagibata", "tenryu", "fujieda",
  "nara", "shiga", "gokase", "ureshino", "asamiya", "kakegawa",
  "kikugawa", "hamamatsu", "kyotanabe", "minamiyamashiro",
  "yamashiro", "sonogi", "kanaya",
];

const COMPOUND = "(?:uji|yame|nishio|shizuoka|kagoshima|sayama|asamiya|honyama)(?:cha|matcha|tea|gyokuro|sencha|hojicha)";

const PRODUCERS = [
  "marukyu\\s*koyamaen", "yamamasa\\s*koyamaen", "horii\\s*shichimeien", "nakamura\\s*tokichi",
  "koyamaen", "ippodo", "tsujiri", "kamitsujien", "shichimeien", "aiya",
  "yamamotoyama", "hoshinoen", "kanbayashi", "marukyu",
];

// Longest alternatives first, so "Marukyu Koyamaen" wins over "Marukyu".
const ORIGIN = new RegExp(
  `\\b(${[COMPOUND, ...PRODUCERS, ...REGIONS].join("|")})\\b`,
  "gi",
);

export type QuotePart = { text: string; origin: boolean };

/** Splits a quote into runs of plain text and origin names, in order. */
export function splitOrigins(quote: string): QuotePart[] {
  const parts: QuotePart[] = [];
  let last = 0;
  ORIGIN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ORIGIN.exec(quote))) {
    const at = m.index;
    if (at > last) parts.push({ text: quote.slice(last, at), origin: false });
    parts.push({ text: m[0], origin: true });
    last = at + m[0].length;
  }
  if (last < quote.length) parts.push({ text: quote.slice(last), origin: false });
  return parts;
}
