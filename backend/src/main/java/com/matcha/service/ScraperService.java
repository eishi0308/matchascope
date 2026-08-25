package com.matcha.service;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Scrapes cafe websites and Instagram profiles for matcha sourcing content.
 *
 * Website scraping:
 *   - Fetches the homepage
 *   - Finds internal links to content pages (About, Menu, Our Story, etc.)
 *   - Scrapes up to MAX_SUBPAGES additional pages
 *   - Returns combined plain text
 *
 * Instagram scraping:
 *   - Fetches the public profile page
 *   - Extracts bio from meta tags (og:description, description)
 *   - Note: Instagram often blocks scrapers — this works on a best-effort basis
 */
@Service
public class ScraperService {

    private static final int    MAX_TEXT_LENGTH = 30_000;
    private static final int    TIMEOUT_MS      = 12_000;
    private static final int    MAX_SUBPAGES    = 10;
    private static final int    MAX_CANDIDATES  = 40;

    /**
     * Path keywords ranked by how likely the page is to carry a sourcing disclosure.
     * Sourcing/about pages beat product listings, which beat generic menu pages.
     * Matched against the URL <em>path only</em> — matching the whole URL made every
     * link on a domain like "takateagarden.com.au" or "ohmatcha.com.au" score alike,
     * which silently reduced page selection to "first three links in the nav bar".
     */
    private static final Map<String, Integer> PATH_KEYWORD_SCORES = new LinkedHashMap<>();
    static {
        PATH_KEYWORD_SCORES.put("sourcing",   10);
        PATH_KEYWORD_SCORES.put("origin",     10);
        PATH_KEYWORD_SCORES.put("our-story",   8);
        PATH_KEYWORD_SCORES.put("about",       8);
        PATH_KEYWORD_SCORES.put("story",       7);
        PATH_KEYWORD_SCORES.put("philosophy",  7);
        PATH_KEYWORD_SCORES.put("values",      6);
        PATH_KEYWORD_SCORES.put("ingredient",  6);
        PATH_KEYWORD_SCORES.put("matcha",      9);
        PATH_KEYWORD_SCORES.put("tea",         5);
        PATH_KEYWORD_SCORES.put("product",     3);
        PATH_KEYWORD_SCORES.put("collection",  3);
        PATH_KEYWORD_SCORES.put("shop",        2);
        PATH_KEYWORD_SCORES.put("menu",        2);
        // Ordering paths. Square, Wix and Squarespace keep the whole catalogue — and with
        // it every origin a cafe states — behind /s/order, /store or /catalog. None of
        // those contain a word this table used to hold, so the one page that named
        // Shizuoka, Uji and Yame scored zero and was discarded before it was ever fetched.
        PATH_KEYWORD_SCORES.put("order",       4);
        PATH_KEYWORD_SCORES.put("/s/",         4);
        PATH_KEYWORD_SCORES.put("store",       3);
        PATH_KEYWORD_SCORES.put("catalog",     3);
        PATH_KEYWORD_SCORES.put("item",        2);
    }

    /**
     * A page fetched successfully is not the same thing as a page read. Sites built in the
     * browser answer 200 with a shell: one measured cafe returned 77 KB of HTML whose whole
     * visible text was "Home | Tori's" — 13 characters — while its shop page stated four
     * Japanese growing regions that no fetch-and-parse crawler can see. Graded as written,
     * that reads as a cafe that discloses nothing. It is a cafe we failed to read, and the
     * two must not share a label.
     */
    private static final int SHELL_MAX_CHARS = 150;

    /**
     * On a site known to build itself in the browser, the bar is higher: a few hundred
     * characters of navigation is what a shell looks like once it has painted its frame.
     * Applied only alongside a platform fingerprint, because on an ordinary site a short
     * page is usually a short page.
     */
    private static final int JS_PLATFORM_MIN_CHARS = 400;

    /** Something on our subject actually rendered, rather than just the page frame. */
    private static final Pattern CONTENT_SIGNAL = Pattern.compile(
            "matcha|tencha|gyokuro|sencha|hojicha|tea|origin|sourc|blend", Pattern.CASE_INSENSITIVE);

    /**
     * Site builders whose pages are assembled in the browser. Detected in the raw HTML of
     * the shell — the markup names the platform even when it carries no content — so these
     * can be sent straight to the renderer instead of being fetched twice.
     */
    private static final Pattern JS_PLATFORM = Pattern.compile(
            "editmysite|squarespace|wix\\.com|wixstatic|shopify|stores\\.jp|weebly|bigcartel",
            Pattern.CASE_INSENSITIVE);

    /**
     * Paths that never carry sourcing information. Excluded outright so they can
     * never consume one of the MAX_SUBPAGES slots.
     */
    private static final List<String> PATH_BLOCKLIST = List.of(
            "my-account", "account", "login", "signin", "sign-in", "register",
            "cart", "checkout", "wishlist", "privacy", "terms", "shipping",
            "returns", "refund", "contact", "faq", "gift-card", "search",
            "recycle", "blog/page", "/tag/", "/author/", "wp-admin", "customer"
    );

    /** Words that make a text window worth keeping when the page must be trimmed. */
    private static final Pattern RELEVANT =
            Pattern.compile("matcha|source|sourc|origin|japan|grown|harvest|farm|garden|tea",
                    Pattern.CASE_INSENSITIVE);

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Result of scrapeWithTracking — combined text, per-page breakdown, and image URLs found.
     *
     * @param looksUnread the fetch succeeded but yielded no readable content: a shell, not
     *                    a cafe that stayed silent. Callers must not grade on this text.
     * @param jsPlatform  the site builder detected in the shell, or null. Present means the
     *                    page is worth re-reading in a browser.
     */
    public record ScrapeResult(String combinedText, Map<String, String> pageTexts,
                               List<String> imageUrls, boolean looksUnread, String jsPlatform) {
        /** Callers that already hold rendered text and only need the shape. */
        public ScrapeResult(String combinedText, Map<String, String> pageTexts, List<String> imageUrls) {
            this(combinedText, pageTexts, imageUrls, false, null);
        }
    }

    /**
     * Whether a successful fetch actually produced something readable.
     * Public so the coverage measurement and the triage tooling apply the same rule.
     */
    public static boolean looksUnread(String text) {
        if (text == null) return true;
        String t = text.strip();
        // Two independent tells, and length alone is not one of them. A first attempt used
        // a 400-character floor and failed its own test: a real page reading "we serve
        // matcha lattes ... sourced from our supplier" is 313 characters, and calling that
        // unread would drop a genuinely silent cafe out of the denominator and push the
        // disclosure rate up. A cafe that said little still said it.
        return t.length() < SHELL_MAX_CHARS || !CONTENT_SIGNAL.matcher(t).find();
    }

    /** As {@link #looksUnread(String)}, with the higher bar a known JS platform earns. */
    public static boolean looksUnread(String text, String jsPlatform) {
        if (looksUnread(text)) return true;
        return jsPlatform != null && text.strip().length() < JS_PLATFORM_MIN_CHARS;
    }

    /**
     * Same as scrape() but also returns a map of {pageUrl → pageText} so callers
     * can identify which specific page a quote came from.
     * Current scraping logic is identical — this just tracks page sources.
     */
    public ScrapeResult scrapeWithTracking(String url) {
        Document homepage = fetchDocument(url);
        if (homepage == null) return null;

        // Read the platform off the raw shell, before the markup that names it is stripped.
        java.util.regex.Matcher platform = JS_PLATFORM.matcher(homepage.html());
        String jsPlatform = platform.find() ? platform.group().toLowerCase() : null;

        // Collect links BEFORE stripping chrome: nav, header and footer are exactly where
        // "About", "Our Story" and "Sourcing" live. Stripping first made those pages
        // unreachable, so the crawler could only ever follow links embedded in body copy.
        List<String> subpageUrls = findContentSubpages(homepage, url);

        // Images are collected before chrome is stripped too — a "sourcing" banner image
        // sits in the same header/about markup a text quote would.
        List<String> imageUrls = new LinkedHashSet<>(findContentImages(homepage)).stream().toList();

        homepage.select("script, style, nav, footer, header, noscript, iframe, svg").remove();
        String homeText = homepage.body().text();

        Map<String, String> pageTexts = new LinkedHashMap<>();
        pageTexts.put(url, homeText);

        int scraped = 0;
        List<String> subImages = new ArrayList<>();
        for (String subUrl : subpageUrls) {
            if (scraped >= MAX_SUBPAGES) break;
            Document subDoc = fetchDocument(subUrl);
            if (subDoc == null) continue;
            subImages.addAll(findContentImages(subDoc));
            subDoc.select("script, style, nav, footer, header, noscript, iframe, svg").remove();
            pageTexts.put(subUrl, subDoc.body().text());
            scraped++;
            sleep(500);
        }

        List<String> allImages = new ArrayList<>(imageUrls);
        for (String img : subImages) if (!allImages.contains(img)) allImages.add(img);

        StringBuilder combined = new StringBuilder();
        pageTexts.values().forEach(t -> combined.append(t).append(" "));
        String text = combined.toString().replaceAll("\\s+", " ").strip();

        String finalText = trimToBudget(text);
        return new ScrapeResult(finalText, pageTexts, allImages,
                looksUnread(finalText, jsPlatform), jsPlatform);
    }

    /**
     * Scrape a website URL: homepage + relevant sub-pages.
     * Returns combined plain text, or null if the site is unreachable.
     */
    public String scrape(String url) {
        Document homepage = fetchDocument(url);
        if (homepage == null) return null;

        // Find sub-pages first — nav, header and footer carry most of a site's
        // internal links, and are removed in the next step.
        List<String> subpageUrls = findContentSubpages(homepage, url);

        // Remove navigation, footer, header — keep content
        homepage.select("script, style, nav, footer, header, noscript, iframe, svg").remove();

        StringBuilder combined = new StringBuilder(homepage.body().text());

        int scraped = 0;
        for (String subUrl : subpageUrls) {
            if (scraped >= MAX_SUBPAGES) break;
            Document subDoc = fetchDocument(subUrl);
            if (subDoc == null) continue;
            subDoc.select("script, style, nav, footer, header, noscript, iframe, svg").remove();
            combined.append(" ").append(subDoc.body().text());
            scraped++;
            sleep(500);
        }

        String text = combined.toString().replaceAll("\\s+", " ").strip();
        return trimToBudget(text);
    }

    /**
     * Scrape an Instagram public profile for bio text.
     * Accepts handles like "@matchacafe", "matchacafe", or full URLs.
     * Returns bio text or null if blocked / not found.
     */
    public String scrapeInstagram(String handle) {
        if (handle == null || handle.isBlank()) return null;

        String username = normaliseInstagramHandle(handle);
        String url      = "https://www.instagram.com/" + username + "/";

        try {
            Document doc = Jsoup.connect(url)
                    .userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")
                    .header("Accept",          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .header("Accept-Encoding", "gzip, deflate, br")
                    .timeout(TIMEOUT_MS)
                    .get();

            // Instagram embeds profile data in meta tags
            String ogDesc   = doc.select("meta[property=og:description]").attr("content");
            String metaDesc = doc.select("meta[name=description]").attr("content");

            StringBuilder bio = new StringBuilder();
            if (!ogDesc.isBlank())   bio.append(ogDesc).append(" ");
            if (!metaDesc.isBlank()) bio.append(metaDesc);

            String result = bio.toString().strip();
            if (result.isEmpty()) return null;

            System.out.printf("[Scraper] Instagram @%s: %s%n", username, result.substring(0, Math.min(80, result.length())));
            return result;

        } catch (Exception e) {
            System.out.printf("[Scraper] Instagram blocked or unavailable for @%s: %s%n", username, e.getMessage());
            return null;
        }
    }

    public boolean mentionsMatcha(String text) {
        return text != null && text.toLowerCase().contains("matcha");
    }

    /** The public profile URL a handle resolves to, so callers can cite it as a source. */
    public String instagramProfileUrl(String handle) {
        if (handle == null || handle.isBlank()) return null;
        String username = normaliseInstagramHandle(handle);
        return username.isBlank() ? null : "https://www.instagram.com/" + username + "/";
    }

    /**
     * True when this URL is an Instagram profile rather than a site of the cafe's own.
     * Stored as the website for a large share of records, where fetching it as a normal
     * page yields a login wall — {@link #scrapeInstagram} reads the bio meta tags instead.
     */
    public boolean isInstagramUrl(String url) {
        if (url == null) return false;
        String host = extractDomain(url);
        return host.equals("instagram.com") || host.endsWith(".instagram.com");
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    /**
     * Fetch a page, retrying once when the failure looks transient.
     *
     * <p>A sweep of the whole database issues thousands of lookups in a row, and the
     * resolver gives out under that load long before the sites do: a full re-run once
     * recorded 438 of 454 cafes as unreachable, every one of them an
     * {@link java.net.UnknownHostException} for a host that resolved perfectly a minute
     * later. Treating that as "this cafe publishes nothing" is how a network hiccup turns
     * into a grade.
     *
     * <p>Only name resolution is retried. Retrying timeouts as well looked like the safer
     * choice and was not: a slow host costs a full {@link #TIMEOUT_MS} per attempt, and
     * with up to {@link #MAX_SUBPAGES} pages behind it a single cafe could occupy four
     * minutes. That took the sweep from twelve seconds a cafe to nearly two hundred. A
     * name that will not resolve fails in milliseconds, so retrying it is nearly free —
     * and it is the failure that was actually corrupting grades.
     */
    private Document fetchDocument(String url) {
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                return Jsoup.connect(url)
                        .userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")
                        .timeout(TIMEOUT_MS)
                        .followRedirects(true)
                        .get();
            } catch (java.net.UnknownHostException e) {
                if (attempt == 2) {
                    System.out.printf("[Scraper] Could not resolve %s after retry%n", url);
                    return null;
                }
                sleep(800);
            } catch (Exception e) {
                System.out.printf("[Scraper] Failed to fetch %s: %s%n", url, e.getMessage());
                return null;
            }
        }
        return null;
    }

    /**
     * Find internal links to content pages, ordered strongest-first.
     *
     * <p>Two things this deliberately does <em>not</em> do, both of which previously
     * hid genuine sourcing disclosures:
     * <ul>
     *   <li>Keywords are matched against the URL <b>path</b>, never the whole URL. On a
     *       domain containing a keyword ("ohmatcha.com.au", "jsytea.com.au") every link
     *       matched, so selection collapsed to document order — nav bar first.</li>
     *   <li>Candidates are <b>ranked</b>, not taken in document order. A "/sourcing" page
     *       linked from the footer now outranks "/my-account" linked from the header.</li>
     * </ul>
     */
    private List<String> findContentSubpages(Document doc, String baseUrl) {
        String baseHost = extractDomain(baseUrl);
        if (baseHost.isBlank()) return List.of();

        // Highest score wins; ties keep document order via LinkedHashMap insertion.
        Map<String, Integer> scored = new LinkedHashMap<>();
        Set<String> seen = new LinkedHashSet<>();

        for (Element link : doc.select("a[href]")) {
            if (scored.size() >= MAX_CANDIDATES) break;

            String href = link.absUrl("href").split("#")[0];
            if (href.isBlank() || !href.startsWith("http")) continue;
            if (!sameSite(href, baseHost))                  continue;
            if (href.equals(baseUrl))                       continue;
            if (!seen.add(href))                            continue;

            String path = pathOf(href);
            if (path.isBlank())                             continue;
            if (PATH_BLOCKLIST.stream().anyMatch(path::contains)) continue;

            int score = 0;
            for (Map.Entry<String, Integer> e : PATH_KEYWORD_SCORES.entrySet()) {
                if (path.contains(e.getKey())) score = Math.max(score, e.getValue());
            }
            // Unscored links are kept as fill rather than dropped. Scoring exists to order a
            // large site's links, not to refuse a small one — a site with four links has
            // budget to spare, and discarding its unscored links is exactly how a catalogue
            // sitting at /s/order went unread. Ranking still puts the promising paths first.
            scored.put(href, score);
        }

        return scored.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue(Comparator.reverseOrder()))
                .map(Map.Entry::getKey)
                .toList();
    }

    /**
     * Filenames that are never a sourcing statement — logos, icons, spinners, tracking
     * pixels. Vision-OCRing every image on a page would mostly pay to be told a favicon
     * has no text in it.
     */
    private static final Pattern JUNK_IMAGE = Pattern.compile(
            "logo|icon|favicon|sprite|pixel|avatar|badge|spinner|loader|placeholder|" +
            "\\.svg(?:\\?|$)|payment|visa|mastercard|paypal|klarna",
            Pattern.CASE_INSENSITIVE);

    private static final int MAX_IMAGES_PER_PAGE = 8;

    /**
     * Candidate image URLs on a page — banner/story graphics, ingredient callouts,
     * certificates — the kind of thing a brand sometimes says in a picture instead of in
     * text the rest of this class already reads. Checks {@code data-src} and similar
     * lazy-load attributes too: a static fetch never runs the JavaScript that would swap
     * a real image in for a placeholder, so {@code src} alone under-reports what a visitor
     * actually sees.
     */
    private List<String> findContentImages(Document doc) {
        List<String> found = new ArrayList<>();
        for (Element img : doc.select("img")) {
            if (found.size() >= MAX_IMAGES_PER_PAGE) break;
            String src = firstNonBlank(img, "src", "data-src", "data-lazy-src", "data-original");
            if (src == null || src.isBlank() || !src.startsWith("http")) continue;
            if (JUNK_IMAGE.matcher(src).find()) continue;
            if (!found.contains(src)) found.add(src);
        }
        return found;
    }

    private String firstNonBlank(Element el, String... attrs) {
        for (String attr : attrs) {
            String v = el.absUrl(attr);
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    /**
     * True when the link belongs to the same registrable site.
     * A substring test ({@code href.contains(domain)}) accepted third-party URLs that
     * merely embed the domain — {@code web.archive.org/web/2019/http://example.com}
     * being the case that matters here, since it injects years-old content as if live.
     */
    private boolean sameSite(String href, String baseHost) {
        String host = extractDomain(href);
        return !host.isBlank() && (host.equals(baseHost)
                || host.endsWith("." + baseHost)
                || baseHost.endsWith("." + host));
    }

    private String pathOf(String url) {
        try {
            String p = URI.create(url).getPath();
            return p == null ? "" : p.toLowerCase();
        } catch (Exception e) {
            return "";
        }
    }

    private String extractDomain(String url) {
        try {
            String host = URI.create(url).getHost();
            return host != null ? host.toLowerCase().replaceFirst("^www\\.", "") : "";
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Trim to MAX_TEXT_LENGTH while preserving passages that could carry a sourcing
     * claim. Head-first truncation discarded the evidence outright on large sites —
     * on the sites audited it removed up to 82% of the text, taking named origins
     * (Yame, Shizuoka, Kyoto) with it while leaving only a generic "from Japan" line
     * behind for the analyser to quote.
     */
    private String trimToBudget(String text) {
        if (text.length() <= MAX_TEXT_LENGTH) return text;

        // Keep a window around every relevant mention, in order, until the budget is spent.
        final int window = 600;
        StringBuilder kept = new StringBuilder();
        var matcher = RELEVANT.matcher(text);
        int cursor = 0;

        while (matcher.find() && kept.length() < MAX_TEXT_LENGTH) {
            int start = Math.max(cursor, matcher.start() - window / 2);
            int end   = Math.min(text.length(), matcher.end() + window);
            if (end <= cursor) continue;
            start = Math.max(start, cursor);
            int room = MAX_TEXT_LENGTH - kept.length();
            if (end - start > room) end = start + room;
            kept.append(text, start, end).append(' ');
            cursor = end;
        }

        // Nothing relevant found — fall back to a plain head slice.
        if (kept.length() == 0) return text.substring(0, MAX_TEXT_LENGTH);
        return kept.toString().strip();
    }

    /**
     * Reduce anything that identifies a profile to the bare username.
     *
     * <p>The scheme is optional and the query string is dropped: records store the
     * profile as a website, and those arrive as "www.instagram.com/cafe?igsh=MTJi…",
     * which the earlier form left intact — producing a request for a username with a
     * share token welded onto it.
     */
    private String normaliseInstagramHandle(String handle) {
        return handle
                .trim()
                .replaceAll("^@", "")
                .replaceAll("(?i)^https?://", "")
                .replaceAll("(?i)^(www\\.)?instagram\\.com/", "")
                .replaceAll("[?#].*$", "")
                .replaceAll("/$", "")
                .trim();
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }
}
