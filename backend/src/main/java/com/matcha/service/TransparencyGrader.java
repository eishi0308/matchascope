package com.matcha.service;

import com.matcha.model.TransparencyLevel;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The single place a transparency level may be decided.
 *
 * <p>The level is never taken from the AI. The grade is derived here from text that
 * demonstrably appears on the cafe's own pages, which makes "Level A with no proof"
 * structurally impossible rather than merely unlikely.
 *
 * <p>Two independent sources of evidence are considered and the stronger wins:
 * the analyser's quote (accepted only if it appears verbatim on the page) and the
 * page text itself. The second exists because the analyser is a single point of
 * failure — it returns one quote, and if it picks a weak one no later gate can
 * recover the disclosure sitting beside it.
 *
 * <p>Gates, in order:
 * <ol>
 *   <li>Quote not present verbatim on the scraped page → discarded (anti-hallucination)</li>
 *   <li>Names a Japanese tea region/prefecture → A</li>
 *   <li>Region fused into a product name ("Matcha Ujicha") → A</li>
 *   <li>Names a Japanese tea producer that grew or milled the leaf → A</li>
 *   <li>Pairs a named farm/garden WITH Japan → A (evidence read straight off the page
 *       must also carry a sourcing verb, since nothing has vouched for it as a
 *       sourcing statement first)</li>
 *   <li>Says Japan but names nothing specific → B</li>
 *   <li>Anything else (incl. naming a non-Japanese distributor) → C</li>
 * </ol>
 *
 * <p>Two things never count as origin evidence: a prefecture appearing in a
 * bibliographic citation ("University of Shizuoka"), and a region stated for a
 * different product on the same page (a Chiran sencha beside an unsourced matcha).
 */
public final class TransparencyGrader {

    /**
     * Japanese tea regions, prefectures and growing towns that constitute a specific origin.
     * Deliberately conservative — a region omitted here grades down to B, which is the safe
     * direction. Short or ambiguous tokens (mie, ise, nara) are excluded to avoid false
     * matches inside unrelated words.
     */
    private static final List<String> JAPANESE_ORIGINS = List.of(
            "uji", "nishio", "kagoshima", "yame", "shizuoka", "kyoto", "fukuoka",
            "aichi", "wazuka", "kirishima", "miyazaki", "sayama", "saitama",
            "asahina", "chiran", "hoshino", "honyama", "kawane", "makinohara",
            "obubu", "yakushima", "kumamoto", "shirakawa", "tsukigase", "okabe",
            "izumo", "yanagibata", "tenryu", "fujieda",
            // Added after auditing live cafe sites: all appeared as stated tea origins
            // on pages the crawler reached but the vocabulary could not recognise.
            // Tea-growing places only — Gifu was tried and removed, because on these
            // sites it names Mino-yaki pottery for matcha bowls, never the leaf.
            "nara", "shiga", "gokase", "ureshino", "asamiya", "kakegawa",
            "kikugawa", "hamamatsu", "kyotanabe", "minamiyamashiro",
            "yamashiro", "sonogi", "kanaya"
    );

    /**
     * Matcha named as a piece of equipment rather than as the drink. A matcha bowl
     * made in Gifu, or a chasen from Nara, discloses nothing about the leaf.
     */
    private static final Pattern MATCHA_EQUIPMENT = Pattern.compile(
            "\\bmatcha\\s+(bowl|bowls|cup|cups|whisk|whisks|chasen|chashaku|scoop|spoon|"
                    + "set|sets|kit|ware|stand|holder|sifter|strainer|tin|caddy|mug)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Compound product names that carry the region inside a single word — "Ujicha",
     * "Ujimatcha", "Yamecha". A word-boundary search for "uji" cannot see these, yet
     * they are one of the commonest ways a site states origin (e.g. a product listed
     * as "Matcha Ujicha"). Matched as a prefix followed by the tea suffix.
     */
    private static final Pattern COMPOUND_ORIGIN = Pattern.compile(
            "\\b(uji|yame|nishio|shizuoka|kagoshima|sayama|asamiya|honyama)"
                    + "(cha|matcha|tea|gyokuro|sencha|hojicha)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Named Japanese tea producers. Naming the house that ground the leaf is a
     * stronger disclosure than naming the country, and is materially different from
     * naming a Western reseller — these are the growers/millers themselves.
     */
    private static final Pattern JAPANESE_PRODUCER = Pattern.compile(
            "\\b(marukyu\\s*koyamaen|koyamaen|ippodo|tsujiri|kamitsujien|yamamasa\\s*koyamaen|"
                    + "horii\\s*shichimeien|shichimeien|aiya|yamamotoyama|nakamura\\s*tokichi|"
                    + "hoshinoen|kanbayashi|marukyu)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Academic and bibliographic context. A health-benefits article citing
     * "University of Shizuoka" or "Aichi Cancer Institute" names a prefecture but
     * discloses nothing about the leaf — without this gate those pages read as
     * Level A evidence.
     */
    private static final Pattern ACADEMIC_NOISE = Pattern.compile(
            "\\b(university|universities|professor|prof\\.|dr\\.|institute|research|"
                    + "journal|j\\.nutr|proc\\.|symposium|et al|studies?|clinical|"
                    + "hospital|patients?|catechin|egcg)\\b",
            Pattern.CASE_INSENSITIVE);

    /** The quote must be about the drink, not an unrelated product on the same page. */
    private static final Pattern MATCHA = Pattern.compile("\\bmatcha\\b", Pattern.CASE_INSENSITIVE);

    /**
     * Other teas and goods a region may belong to. "Shizuoka Sencha … blended with
     * matcha powder" names a region for the sencha base, not for the matcha; without
     * this the passage reads as a matcha origin disclosure because both words appear
     * in the same sentence.
     */
    private static final Pattern OTHER_PRODUCT = Pattern.compile(
            "\\s*[-,:]?\\s*(sencha|gyokuro|hojicha|houjicha|genmaicha|bancha|kukicha|"
                    + "kamairicha|oolong|black tea|barley|mugicha|sobacha|yuzu|"
                    + "teaware|tea ware|ware|pottery|porcelain|ceramic|bowl|whisk|chasen)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Encyclopedia copy about matcha as a category, rather than a claim about the matcha
     * this cafe pours.
     *
     * <p>"Matcha is a traditional Japanese green tea" names Japan and mentions matcha, and
     * so cleared the Japan-alone route to B — but it is the opening line of every matcha
     * explainer on the web and discloses nothing whatever about sourcing. Level B means
     * this cafe has established its own matcha is Japanese; a definition of the drink is
     * not that claim, and admitting it would manufacture disclosures wholesale across a
     * bucket of cafes whose pages carry a stock matcha blurb.
     */
    private static final Pattern GENERIC_MATCHA_LORE = Pattern.compile(
            "\\bmatcha\\s+(?:is|was|has\\s+been|are)\\b"
                    + "|\\bwhat\\s+is\\s+matcha\\b"
                    + "|\\btea\\s+ceremony\\b"
                    + "|\\boriginat(?:ed|es|ing)\\b"
                    + "|\\bfor\\s+centuries\\b"
                    + "|\\bdates?\\s+back\\b",
            Pattern.CASE_INSENSITIVE);

    /** Language that marks a genuine sourcing statement rather than a product label. */
    private static final Pattern SOURCING_VERB = Pattern.compile(
            "\\b(sourced|grown|harvested|imported|milled|stone-?ground|cultivated|"
                    + "picked|produced|shipped|comes? from|direct(ly)? from)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Letter-spacing artefacts left by scraped navigation menus ("G reen Tea",
     * "Es tate"). Used only to prefer better-reading quotes, never to decide a level.
     */
    private static final Pattern NAV_CHROME = Pattern.compile("\\b[A-Za-z]\\s[a-z]{2,}\\b");

    /**
     * A named production entity — a farm, garden or estate that grew the leaf.
     *
     * <p>Deliberately excludes bare provenance verbs ("grown in", "harvested in",
     * "imported from", "sourced from"). Those restate the country and nothing more:
     * "harvested in Japan" is the definition of Level B, not A. Only a named facility,
     * paired with Japan, is specific enough to clear the A bar.
     *
     * <p>On its own this still proves nothing — "single-origin matcha from Zen Wonders"
     * names an Australian reseller — so Japan must appear in the same quote.
     */
    private static final Pattern NAMED_FACILITY = Pattern.compile(
            "\\b(tea garden|tea farm|family farm|our farm|our garden|our estate|"
                    + "estate|plantation|cooperative|tea master|tea grower|"
                    + "farmer'?s?|growers?)\\b",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern JAPAN =
            Pattern.compile("\\bjapan(ese)?\\b", Pattern.CASE_INSENSITIVE);

    /** Length of the leading fingerprint used for the verbatim check. */
    private static final int FINGERPRINT_LENGTH = 60;

    private TransparencyGrader() {}

    /**
     * Grade a freshly scraped cafe. Runs every gate including the verbatim check.
     *
     * @param quote          the AI-supplied evidence quote (may be null)
     * @param scrapedContent the full text actually scraped from the cafe's pages
     */
    public static TransparencyLevel grade(String quote, String scrapedContent) {
        Evidence e = decide(quote, scrapedContent);
        return e == null ? TransparencyLevel.C : e.level();
    }

    /**
     * Settle both the level and the quote that justifies it.
     *
     * <p>Considers the analyser's quote and the page text independently, then keeps
     * whichever proves more — so a weak pick by the analyser no longer caps the grade,
     * and the stored quote always matches the grade actually awarded.
     *
     * @return the winning evidence, or null when nothing on the page supports A or B
     */
    public static Evidence decide(String aiQuote, String scrapedContent) {
        Evidence fromAi = null;
        if (aiQuote != null && !aiQuote.isBlank() && appearsVerbatim(aiQuote, scrapedContent)) {
            TransparencyLevel lvl = gradeVerifiedQuote(aiQuote);
            if (levelRequiresEvidence(lvl)) fromAi = new Evidence(aiQuote, lvl);
        }

        Evidence fromText = findBestEvidence(scrapedContent);

        if (fromAi == null)   return fromText;
        if (fromText == null) return fromAi;
        // Stronger grade wins; on a tie keep the analyser's quote, which reads better.
        return fromText.level().compareTo(fromAi.level()) < 0 ? fromText : fromAi;
    }

    /**
     * Grade a quote whose verbatim presence has already been established — used when
     * re-grading rows already stored in the database. Callers that have not verified the
     * quote against live page text must use {@link #grade(String, String)} instead.
     */
    public static TransparencyLevel gradeVerifiedQuote(String quote) {
        if (quote == null || quote.isBlank()) return TransparencyLevel.C;

        String lower = quote.toLowerCase(Locale.ROOT);
        boolean namesJapan = JAPAN.matcher(quote).find();

        // Bibliographic text names prefectures without disclosing anything about the leaf.
        boolean academic = ACADEMIC_NOISE.matcher(quote).find();

        // A named Japanese region is the strongest possible disclosure — unless the quote
        // is about a different tea entirely.
        boolean otherTeasOnly = regionClaimedByAnotherTea(quote);

        if (!academic && !otherTeasOnly
                && JAPANESE_ORIGINS.stream().anyMatch(region -> containsWord(lower, region))) {
            return TransparencyLevel.A;
        }

        // Region embedded in a product name: "Matcha Ujicha", "Yamecha".
        if (!academic && !otherTeasOnly && COMPOUND_ORIGIN.matcher(quote).find()) {
            return TransparencyLevel.A;
        }

        // The Japanese house that grew or milled the leaf, named outright.
        if (JAPANESE_PRODUCER.matcher(quote).find()) {
            return TransparencyLevel.A;
        }

        // A named farm/garden counts only when tied to Japan, never on its own.
        if (namesJapan && NAMED_FACILITY.matcher(quote).find()) {
            return TransparencyLevel.A;
        }

        // Japan named, nothing more specific — Level B, on exactly the terms the page scan
        // uses. The country has to be said about the matcha: "Origin: Japan" lifted off a
        // genmaicha product page names it for the wrong tea, and "premium Japanese Green
        // Tea blended with Matcha powder" describes a blend whose Japanese half is the
        // green tea. Both cleared this route while the page scan refused them, which is
        // the same split, in the same place, that {@link #claimsJapaneseMatcha} was written
        // to close on the other side.
        if (namesJapan
                && !GENERIC_MATCHA_LORE.matcher(quote).find()
                && claimsJapaneseMatcha(quote)) {
            return TransparencyLevel.B;
        }

        // Names only a brand or distributor, or is pure marketing copy.
        return TransparencyLevel.C;
    }

    /** A passage lifted verbatim from the page, together with what it proves. */
    public record Evidence(String quote, TransparencyLevel level) {}

    /**
     * Search the scraped text directly for the strongest sourcing disclosure it contains.
     *
     * <p>Exists because the analyser is a single point of failure: it returns one quote,
     * and every gate downstream can only judge that one quote. On the sites audited it
     * repeatedly returned "…from Japan" while a named region sat in the same text it had
     * been given — and no later stage could recover, because no later stage looked.
     *
     * <p>Anything returned here is by construction a verbatim substring of the page.
     *
     * @return the strongest evidence found, or null when the text supports nothing
     */
    public static Evidence findBestEvidence(String scrapedContent) {
        if (scrapedContent == null || scrapedContent.isBlank()) return null;

        Evidence best = null;
        int bestQuality = Integer.MIN_VALUE;

        for (String passage : candidatePassages(scrapedContent)) {
            TransparencyLevel level = gradeExtractedPassage(passage);
            if (!levelRequiresEvidence(level)) continue;

            int quality = passageQuality(passage);
            boolean stronger = best == null || level.compareTo(best.level()) < 0;
            boolean betterWorded = best != null && level == best.level() && quality > bestQuality;
            if (stronger || betterWorded) {
                best = new Evidence(polishSafely(passage, level), level);
                bestQuality = quality;
            }
        }
        return best;
    }

    /**
     * Storefront furniture that scrapes into the text ahead of the sentence that
     * matters — shipping banners, breadcrumbs, pickup notices.
     */
    /**
     * The header Instagram puts above every profile — the login prompt, the handle, and
     * the follower counts. Reading profiles in a browser is the only way to get at a bio
     * that names a region, and this arrives welded to the front of it.
     */
    private static final Pattern INSTAGRAM_CHROME = Pattern.compile(
            "^\\s*log\\s*in\\s*sign\\s*up\\s+\\S+\\s+[\\d.,]+[KkMm]?\\s+followers\\s+"
                    + "[\\d.,]+[KkMm]?\\s+following\\s*",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern LEADING_CHROME = Pattern.compile(
            "^(?:\\W*\\b(?:couldn't load pickup availability|pickup availability|refresh|"
                    + "skip to (?:content|main)|learn more|free (?:express )?shipping[^.]{0,60}?|"
                    + "home|menu|search|cart|shop all|view all|quick view|new arrivals|sale)\\b\\W*)+",
            Pattern.CASE_INSENSITIVE);

    /**
     * Tidy the passage for display without altering its wording — the result must stay
     * a verbatim substring of the page, so only whole leading fragments are removed.
     */
    private static String polishSafely(String passage, TransparencyLevel level) {
        String polished = polish(passage);
        // Trimming must never remove the very words the grade rests on.
        return gradeExtractedPassage(polished) == level ? polished : passage.strip();
    }

    private static String polish(String passage) {
        String out = INSTAGRAM_CHROME.matcher(passage).replaceAll("").strip();
        out = LEADING_CHROME.matcher(out).replaceAll("").strip();
        // Drop a dangling partial word left by the window edge ("ow Free Express...").
        if (out.length() > 30 && out.matches("(?s)^[a-z]{1,3}\\s.*")) {
            out = out.substring(out.indexOf(' ') + 1).strip();
            out = LEADING_CHROME.matcher(out).replaceAll("").strip();
        }
        return out.isBlank() ? passage.strip() : out;
    }

    /**
     * Grade a passage lifted straight from the page.
     *
     * <p>Runs the same ladder as {@link #gradeVerifiedQuote}, including the
     * "named farm/garden + Japan" route to Level A — with one extra condition on that
     * route only. An analyser-supplied quote arrives having already been chosen as a
     * sourcing statement; a passage cut from raw page text has not, and a navigation
     * menu reading "Single Estate Plantation … Japanese Green Teas" satisfies
     * facility-plus-Japan while disclosing nothing. Requiring a sourcing verb in the
     * same passage restores the guarantee the analyser was providing, so both routes
     * to A now rest on the same evidence rather than on which channel found it.
     */
    private static TransparencyLevel gradeExtractedPassage(String passage) {
        if (ACADEMIC_NOISE.matcher(passage).find()) return TransparencyLevel.C;
        if (describesEquipmentOnly(passage)) return TransparencyLevel.C;

        if (namesRegionForMatcha(passage)) return TransparencyLevel.A;
        if (JAPANESE_PRODUCER.matcher(passage).find()) return TransparencyLevel.A;

        boolean namesJapan = JAPAN.matcher(passage).find();
        if (namesJapan
                && NAMED_FACILITY.matcher(passage).find()
                && SOURCING_VERB.matcher(passage).find()) {
            return TransparencyLevel.A;
        }

        // Japan must be attached to the matcha, not merely present on the page.
        if (namesJapan
                && !GENERIC_MATCHA_LORE.matcher(passage).find()
                && claimsJapaneseMatcha(passage)) {
            return TransparencyLevel.B;
        }
        return TransparencyLevel.C;
    }

    /**
     * Japan tied to the cafe's own matcha, rather than to its décor, its cuisine or its
     * navigation menu.
     *
     * <p>Level B previously followed from any matcha-bearing passage that mentioned Japan
     * anywhere in it. Across a full sweep of the Level C bucket that admitted, among
     * others: "Japanese-inspired cafe menu, coffee, matcha and more", "Tokyo vibes,
     * premium Matcha, Japanese sweets", "seasonal creations inspired by Japan's quiet
     * beauty", "Japanese refinement meets Italian classic tradition", and a tea shop's
     * navigation bar listing every variety it stocks. None of them says where the matcha
     * came from, and "Japanese-inspired" says almost the opposite.
     *
     * <p>What the published Level B records actually look like is narrower: the word
     * Japanese modifying matcha directly ("Japanese Organic Matcha", "Japan-grown
     * Matcha"), or matcha linked to Japan by a verb of supply ("matcha ... imported from
     * Japan", "our Matcha ... harvested in Japan").
     */
    private static final Pattern JAPANESE_MATCHA_CLAIM = Pattern.compile(
            // "Japanese matcha", "Japanese Organic Matcha", "Japan-grown Matcha".
            // A conjunction in the gap breaks the modifier: "Japanese teas and matcha"
            // describes a tasting of Japanese teas plus matcha, not Japanese matcha.
            "\\bjapan(?:ese)?(?:[-\\s]grown|[-\\s]sourced)?\\s+"
                    + "(?:(?!and\\s|or\\s|with\\s)\\w+\\s+){0,2}matcha\\b"
                    // "matcha ... from Japan". Only "from" — a bare "in Japan" also covers
                    // "introducing Japanese food culture to people ... in Japan", which is a
                    // statement about an audience, not about where the leaf was grown.
                    + "|\\bmatcha\\b[^.!?]{0,90}?\\bfrom\\s+japan\\b"
                    // "matcha, grown in Japan" with the verb ahead of the country
                    + "|\\bmatcha\\b[^.!?]{0,90}?\\b(?:sourced|grown|harvested|imported|milled|"
                    + "produced|shipped|cultivated)\\b[^.!?]{0,30}?\\bjapan\\b",
            Pattern.CASE_INSENSITIVE);

    private static boolean claimsJapaneseMatcha(String passage) {
        return JAPANESE_MATCHA_CLAIM.matcher(passage).find();
    }

    /**
     * True when the passage names a Japanese region that belongs to the matcha rather than
     * to something else on the page.
     *
     * <p>Checking only the words immediately after the region was not enough. A tea list
     * reading "premium tea from Shizuoka, Mt Fuji, in leaf form from Sencha, Genmaicha and
     * Hojicha" states a region for the leaf teas while the matcha paragraph above it names
     * no origin at all, and "single origin sencha green tea from Uji Kyoto" puts the other
     * tea in front of the region rather than behind it. Both read as Level A evidence under
     * an after-only test.
     *
     * <p>So the region must sit near a mention of matcha, and matcha must be the nearest
     * product to it — unless the two are named together ("our matcha and hojicha travel
     * from Kyoto"), where the origin is being claimed for both.
     */
    private static boolean namesRegionForMatcha(String passage) {
        String lower = passage.toLowerCase(Locale.ROOT);

        for (String region : JAPANESE_ORIGINS) {
            var m = Pattern.compile("\\b" + Pattern.quote(region) + "\\b").matcher(lower);
            while (m.find()) {
                if (regionBelongsToMatcha(passage, lower, m.start(), m.end())) return true;
            }
        }
        var c = COMPOUND_ORIGIN.matcher(passage);
        while (c.find()) {
            // The region is fused into the product name itself ("Matcha Ujicha"), so there
            // is no neighbouring product it could belong to instead.
            if (!claimedByOtherProduct(passage, c.end())) return true;
        }
        return false;
    }

    /**
     * A quote that names another tea and never names matcha is about that other tea, and
     * any region in it is that tea's origin.
     *
     * <p>The analyser-quote route to Level A trusted the analyser to have picked a matcha
     * sourcing statement, and mostly it does. Across the full Level C sweep it also
     * produced "Single origin 1st spring harvested sencha green tea from Uji Kyoto" and
     * a shop listing "premium tea from Shizuoka, Mt Fuji, in leaf form from Sencha,
     * Genmaicha and Hojicha" — both graded A on a region belonging to leaf tea. The page
     * scan already refuses these; without the same refusal here, which grade a cafe gets
     * depends on which channel happened to speak, and {@link #decide} prefers this one on
     * a tie.
     *
     * <p>Deliberately narrow: a quote naming no other tea is left alone, so evidence like
     * "Sourced from Kyoto, Japan, this first-harvest blend..." keeps its grade.
     */
    private static boolean regionClaimedByAnotherTea(String quote) {
        return OTHER_PRODUCT.matcher(quote).find() && !MATCHA.matcher(quote).find();
    }

    /**
     * Japanese place names that arrive attached to food rather than to tea.
     *
     * <p>Prefectures are famous for more than leaf. "A5 Miyazaki Steak … DESSERT MATCHA
     * PANNA COTTA" puts a beef region within a few words of a matcha dessert, and
     * "Gyukatsu Kyoto Katsugyu Sydney" is a restaurant's own name sitting beside a matcha
     * cake on the same menu. Both read as a matcha origin on proximity alone. Nothing is
     * ever co-sourced between a steak and a tea, so unlike another tea there is no
     * coordination case to allow.
     */
    private static final Pattern NON_TEA_PRODUCT = Pattern.compile(
            "\\b(?:\\w*katsu\\w*|steak|beef|wagyu|pork|chicken|ramen|udon|soba|sushi|"
                    + "sashimi|gyoza|karaage|donburi|curry|burger|yakitori|tempura|"
                    + "okonomiyaki|yakiniku)\\b",
            Pattern.CASE_INSENSITIVE);

    /** How far from a region a matcha mention may sit and still be the thing it describes. */
    private static final int ORIGIN_PROXIMITY = 80;

    private static boolean regionBelongsToMatcha(String passage, String lower, int start, int end) {
        if (claimedByOtherProduct(passage, end)) return false;

        int matcha = nearestMatch(lower, MATCHA, start, end);
        if (matcha < 0 || matcha > ORIGIN_PROXIMITY) return false;

        // A dish standing closer to the place name than the matcha does owns it.
        int dish = nearestMatch(lower, NON_TEA_PRODUCT, start, end);
        if (dish >= 0 && dish < matcha) return false;

        int other = nearestMatch(lower, OTHER_PRODUCT, start, end);
        if (other < 0 || matcha <= other) return true;

        // The nearer product may simply be listed alongside the matcha, in which case the
        // origin covers both: "our matcha and hojicha", "matcha, sencha and gyokuro".
        return namedTogetherWithMatcha(lower);
    }

    /** Distance from the region to the closest match of {@code what}, or -1 if absent. */
    private static int nearestMatch(String lower, Pattern what, int start, int end) {
        int best = -1;
        var m = what.matcher(lower);
        while (m.find()) {
            int distance = m.end() <= start ? start - m.end()
                    : m.start() >= end ? m.start() - end
                    : 0;
            if (best < 0 || distance < best) best = distance;
        }
        return best;
    }

    /** Matcha and another tea joined in one list, so a stated origin covers both. */
    private static final Pattern COORDINATED_WITH_MATCHA = Pattern.compile(
            "\\bmatcha\\b\\s*(?:,|and|&|/)\\s*(?:\\w+\\s+){0,2}"
                    + "(?:sencha|gyokuro|hojicha|houjicha|genmaicha|bancha|kukicha)\\b"
                    + "|(?:sencha|gyokuro|hojicha|houjicha|genmaicha|bancha|kukicha)\\b"
                    + "\\s*(?:,|and|&|/)\\s*(?:\\w+\\s+){0,2}\\bmatcha\\b",
            Pattern.CASE_INSENSITIVE);

    private static boolean namedTogetherWithMatcha(String lower) {
        return COORDINATED_WITH_MATCHA.matcher(lower).find();
    }

    /**
     * True when every mention of matcha in the passage names equipment. Such a passage
     * can still carry a Japanese place name — Mino-yaki bowls are made in Gifu — while
     * saying nothing whatever about where the tea was grown.
     */
    private static boolean describesEquipmentOnly(String passage) {
        var all = MATCHA.matcher(passage);
        int mentions = 0;
        while (all.find()) mentions++;
        if (mentions == 0) return false;

        var equipment = MATCHA_EQUIPMENT.matcher(passage);
        int equipmentMentions = 0;
        while (equipment.find()) equipmentMentions++;
        return equipmentMentions >= mentions;
    }

    /** Does another product name follow immediately after this origin mention? */
    private static boolean claimedByOtherProduct(String passage, int originEnd) {
        if (originEnd >= passage.length()) return false;
        String tail = passage.substring(originEnd, Math.min(passage.length(), originEnd + 22));
        var m = OTHER_PRODUCT.matcher(tail);
        return m.lookingAt();
    }

    /**
     * Prefer evidence that reads as a sourcing statement over a bare product label,
     * among passages that already prove the same level. Affects presentation only.
     */
    private static int passageQuality(String passage) {
        int score = 0;
        if (SOURCING_VERB.matcher(passage).find()) score += 6;
        int len = passage.length();
        if (len >= 50 && len <= 260) score += 3;
        else if (len > 260) score += 1;

        // Count spacing artefacts; menus are dense with them.
        var chrome = NAV_CHROME.matcher(passage);
        int artefacts = 0;
        while (chrome.find() && artefacts < 4) artefacts++;
        return score - artefacts * 2;
    }

    /** Longest passage considered; anything longer is tightened around its matcha mention. */
    private static final int MAX_PASSAGE = 320;

    /**
     * Boundaries between separate claims. Prices and storefront chrome are what
     * separates one product from the next in scraped shop text, alongside ordinary
     * sentence ends.
     */
    private static final Pattern SEGMENT_BOUNDARY = Pattern.compile(
            "(?<=[.!?])\\s+"
                    + "|\\$\\s?[\\d,]+(?:\\.\\d+)?"
                    + "|(?i)\\b(?:add to cart|quick view|choose options|sold out|out of stock|"
                    + "regular price|sale price|unit price|no reviews|more info|read more|"
                    + "shop now|view all|quantity|add to wishlist|select options)\\b");

    /**
     * Split the page into passages that each make a single claim, keeping only those
     * that mention matcha.
     *
     * <p>Passages are bounded rather than fixed-width windows because scraped shop
     * pages list products back to back: a window wide enough to capture "matcha …
     * Uji, Kyoto" also reaches into the neighbouring listing and would read a Chiran
     * sencha or a Gifu teapot as though it described the matcha.
     */
    private static List<String> candidatePassages(String text) {
        List<String> out = new java.util.ArrayList<>();
        for (String segment : SEGMENT_BOUNDARY.split(text)) {
            String s = segment.strip();
            if (s.isEmpty() || !MATCHA.matcher(s).find()) continue;
            if (s.length() > MAX_PASSAGE) out.addAll(tightenAroundMatcha(s));
            else out.add(s);
            if (out.size() >= 80) break;
        }
        return out;
    }

    /**
     * Clamp an overlong passage to windows around each matcha mention — every mention
     * gets its own window, not just the first.
     *
     * <p>{@link #SEGMENT_BOUNDARY} splits on sentence punctuation, and a page with none
     * (an Instagram bio: "OUJI | Matcha Cafe & Pop Up … we're using 1st harvest Uji
     * matcha 🍵") stays a single run-on segment. Anchoring the one window to only the
     * first "matcha" cut off exactly this case: the generic "Matcha Cafe" in the name
     * sat ~190 characters before the real disclosure, outside a single ±150 window, so
     * the sourcing statement was discarded before grading ever saw it. A separate window
     * per mention lets {@link #findBestEvidence}'s existing "grade every candidate, keep
     * the strongest" loop find the one that actually carries the claim.
     */
    private static List<String> tightenAroundMatcha(String passage) {
        List<String> windows = new java.util.ArrayList<>();
        var m = MATCHA.matcher(passage);
        while (m.find() && windows.size() < 5) {
            int start = Math.max(0, m.start() - 150);
            int end = Math.min(passage.length(), m.end() + 150);
            windows.add(passage.substring(start, end).strip());
        }
        return windows.isEmpty() ? List.of(passage.substring(0, MAX_PASSAGE)) : windows;
    }

    /**
     * True when the leading fingerprint of the quote appears in the scraped content,
     * ignoring whitespace and case differences.
     */
    public static boolean appearsVerbatim(String quote, String scrapedContent) {
        if (quote == null || quote.isBlank() || scrapedContent == null || scrapedContent.isBlank()) {
            return false;
        }
        String normContent = normalise(scrapedContent);
        String normQuote = normalise(quote);
        String fingerprint = normQuote.length() > FINGERPRINT_LENGTH
                ? normQuote.substring(0, FINGERPRINT_LENGTH)
                : normQuote;
        return normContent.contains(fingerprint);
    }

    /** Evidence fields may only be stored when the grade actually rests on them. */
    public static boolean levelRequiresEvidence(TransparencyLevel level) {
        return level == TransparencyLevel.A || level == TransparencyLevel.B;
    }

    private static String normalise(String s) {
        return s.replaceAll("\\s+", " ").toLowerCase(Locale.ROOT).strip();
    }

    /** Word-boundary match, so "mie" never matches inside "premium". */
    private static boolean containsWord(String haystack, String word) {
        return Pattern.compile("\\b" + Pattern.quote(word) + "\\b").matcher(haystack).find();
    }
}
