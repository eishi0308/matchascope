package com.matcha.service;

import com.matcha.model.Cafe;
import com.matcha.model.CafeResponse;
import com.matcha.model.TransparencyLevel;
import com.matcha.repository.CafeRepository;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class CafeService {

    @Autowired
    private CafeRepository cafeRepository;

    @Autowired
    private GooglePlacesService googlePlacesService;

    @Autowired
    private ScraperService scraperService;

    @Autowired
    private OpenAiService openAiService;

    @Autowired
    private MenuPhotoVerifier menuPhotoVerifier;

    @Autowired
    private WebsiteImageVerifier websiteImageVerifier;

    @Autowired
    private ApiBudgetGuard budgetGuard;

    @Value("${google.places.api.key:}")
    private String googlePlacesApiKey;

    @Value("${photoverify.enabled:false}")
    private boolean photoVerifyEnabled;

    private volatile boolean discovering = false;

    public boolean isDiscovering() { return discovering; }

    /** Used/ceiling/remaining for the two APIs {@link MenuPhotoVerifier} spends against. */
    public ApiBudgetGuard.UsageSnapshot getPhotoVerifyUsage() {
        return budgetGuard.snapshot();
    }

    // ── Startup ───────────────────────────────────────────────────────────────

    @PostConstruct
    public void initialize() {
        long count = cafeRepository.count();

        if (count > 0) {
            // DB already has data — load instantly, no discovery needed
            System.out.printf("[CafeService] Database has %d cafes — ready instantly. Use POST /api/cafes/discover to refresh.%n", count);
            return;
        }

        // Empty DB — run full discovery for the first time
        if (googlePlacesApiKey != null && !googlePlacesApiKey.isBlank()) {
            System.out.println("[CafeService] Empty database — starting first-time discovery...");
            discovering = true;
            Thread thread = new Thread(() -> {
                try {
                    int found = discoverAndSave();
                    System.out.printf("[CafeService] First-time discovery complete — %d cafes added.%n", found);
                } catch (Exception e) {
                    System.err.println("[CafeService] Discovery failed: " + e.getMessage());
                } finally {
                    discovering = false;
                }
            }, "cafe-discovery-thread");
            thread.setDaemon(true);
            thread.start();
        } else {
            System.out.println("[CafeService] No Google Places API key — skipping discovery.");
        }
    }

    // ── Query methods ─────────────────────────────────────────────────────────

    public List<CafeResponse> findAll(String city, String level) {
        List<Cafe> cafes;

        if (city != null && !city.isBlank() && level != null && !level.isBlank()) {
            TransparencyLevel lvl = TransparencyLevel.valueOf(level.toUpperCase());
            cafes = cafeRepository.findByCityAndLevel(city, lvl);
        } else if (city != null && !city.isBlank()) {
            cafes = cafeRepository.findByCityIgnoreCase(city);
        } else if (level != null && !level.isBlank()) {
            cafes = cafeRepository.findByLevel(TransparencyLevel.valueOf(level.toUpperCase()));
        } else {
            cafes = cafeRepository.findAll();
        }

        List<CafeResponse> responses = new ArrayList<>();
        for (Cafe c : cafes) responses.add(CafeResponse.from(c));
        return responses;
    }

    public Optional<CafeResponse> findById(String id) {
        return cafeRepository.findById(id).map(CafeResponse::from);
    }

    public Map<String, Object> getStats() {
        List<Cafe> all = cafeRepository.findAll();
        Map<String, Long> byLevel = new LinkedHashMap<>();
        byLevel.put("A", all.stream().filter(c -> c.getLevel() == TransparencyLevel.A).count());
        byLevel.put("B", all.stream().filter(c -> c.getLevel() == TransparencyLevel.B).count());
        byLevel.put("C", all.stream().filter(c -> c.getLevel() == TransparencyLevel.C).count());
        byLevel.put("D", all.stream().filter(c -> c.getLevel() == TransparencyLevel.D).count());

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", (long) all.size());
        stats.put("byLevel", byLevel);
        stats.put("sydney", all.stream().filter(c -> "Sydney".equals(c.getCity())).count());
        stats.put("melbourne", all.stream().filter(c -> "Melbourne".equals(c.getCity())).count());
        stats.put("discovering", discovering);
        return stats;
    }

    // ── Discovery pipeline ────────────────────────────────────────────────────

    /**
     * Run the full discovery pipeline:
     * 1. Query Overpass for cafes in Sydney and Melbourne
     * 2. For each with a website, scrape it for matcha mentions
     * 3. Send to Claude for transparency analysis
     * 4. Save new cafes to database
     *
     * @return count of newly discovered cafes
     */
    public int discoverAndSave() throws Exception {
        record CityConfig(String name, double lat, double lng) {}
        List<CityConfig> cities = List.of(
                new CityConfig("Sydney",    -33.8688, 151.2093),
                new CityConfig("Melbourne", -37.8136, 144.9631)
        );

        int discovered = 0;
        String verifiedDate = LocalDate.now().format(DateTimeFormatter.ofPattern("MMMM yyyy"));

        for (CityConfig city : cities) {
            System.out.printf("[Discovery] Searching Google Places for matcha cafes in %s...%n", city.name());
            List<GooglePlacesService.PlaceInfo> places = googlePlacesService.searchMatchaCafes(city.name(), city.lat(), city.lng());
            System.out.printf("[Discovery] Found %d places in %s%n", places.size(), city.name());

            for (GooglePlacesService.PlaceInfo place : places) {
                // Skip if already in DB
                if (cafeRepository.existsByNameAndCity(place.name(), city.name())) continue;

                // Scrape website + Instagram, combine into one content block
                StringBuilder combined = new StringBuilder();

                ScraperService.ScrapeResult scrapeResult = null;
                if (place.website() != null) {
                    System.out.printf("[Discovery] Scraping website: %s%n", place.website());
                    scrapeResult = scraperService.scrapeWithTracking(place.website());
                    // A shell answers 200 and yields nothing. Appending its handful of nav
                    // words would let the grader read them as a cafe that disclosed nothing,
                    // when in fact nothing was read at all — the distinction this method
                    // already draws further down for blank content. Leave the text out so
                    // the cafe takes the absent-measurement path instead of a false negative.
                    if (scrapeResult != null && scrapeResult.looksUnread()) {
                        System.out.printf("[Discovery] → %s returned a shell (%d chars%s) — not graded on it%n",
                                place.website(), scrapeResult.combinedText().length(),
                                scrapeResult.jsPlatform() != null ? ", " + scrapeResult.jsPlatform() : "");
                    } else if (scrapeResult != null) {
                        combined.append(scrapeResult.combinedText());
                    }
                }

                if (place.instagram() != null) {
                    String igContent = scraperService.scrapeInstagram(place.instagram());
                    if (igContent != null) combined.append(" ").append(igContent);
                }

                String content = combined.toString().strip();

                // Google already filtered for matcha via search query — trust it.
                // Only skip if AI explicitly says it does NOT serve matcha (and name has no matcha either).
                OpenAiService.CafeAnalysis analysis = null;
                if (!content.isBlank()) {
                    System.out.printf("[Discovery] → Sending to OpenAI for analysis...%n");
                    analysis = openAiService.analyze(place.name(), place.website(), content);
                }

                // Nothing was read from a website or Instagram — before this cafe falls to
                // Level D, check whether its own Google Maps listing has a menu photo that
                // discloses sourcing. Most cafes with no scrapable content have no web
                // presence beyond that listing at all. Graded through the exact same gate
                // as the website path (TransparencyGrader.findBestEvidence).
                MenuPhotoVerifier.PhotoEvidence photoEvidence = null;
                if (content.isBlank() && photoVerifyEnabled) {
                    photoEvidence = menuPhotoVerifier.verify(place).orElse(null);
                    if (photoEvidence != null) {
                        System.out.printf("[Discovery] → Found sourcing evidence in a Google Maps photo (Level %s)%n",
                                photoEvidence.level());
                    }
                }

                // Find which specific page the quote was found on
                String exactSourceUrl = findQuoteSourcePage(analysis, scrapeResult);

                if (analysis != null && !analysis.servesMatcha() && !place.name().toLowerCase().contains("matcha")) {
                    // AI confirmed it does NOT serve matcha — skip
                    sleep(500);
                    continue;
                }

                System.out.printf("[Discovery] → Matcha confirmed! Saving...%n");

                Cafe cafe = buildDiscoveredCafe(place, city.name(), analysis, verifiedDate, exactSourceUrl, content, scrapeResult, photoEvidence);
                cafeRepository.save(cafe);
                discovered++;
                System.out.printf("[Discovery] → Saved '%s' as Level %s%n", place.name(), cafe.getLevel());

                sleep(2000); // be polite to websites
            }

            sleep(3000); // pause between cities
        }

        if (photoVerifyEnabled) {
            ApiBudgetGuard.UsageSnapshot usage = budgetGuard.snapshot();
            System.out.printf("[PhotoVerify] Run summary — Places: %d/%d free requests used (%d remaining). "
                            + "OpenAI vision: $%.4f / $%.2f ceiling spent.%n",
                    usage.placesUsed(), usage.placesCeiling(), usage.placesCeiling() - usage.placesUsed(),
                    usage.openAiSpent(), usage.openAiDollarCeiling());
        }

        System.out.printf("[Discovery] Done. Discovered %d new cafes.%n", discovered);
        return discovered;
    }

    private Cafe buildDiscoveredCafe(GooglePlacesService.PlaceInfo place, String city, OpenAiService.CafeAnalysis analysis, String verifiedDate, String exactSourceUrl, String scrapedContent, ScraperService.ScrapeResult scrapeResult, MenuPhotoVerifier.PhotoEvidence photoEvidence) {
        long count = cafeRepository.count();
        String prefix = city.substring(0, 3).toLowerCase();
        String id = prefix + "-disc-" + String.format("%03d", count + 1);

        Cafe cafe = new Cafe();
        cafe.setId(id);
        cafe.setGoogleId(place.googleId());
        cafe.setName(place.name());
        cafe.setCity(city);
        cafe.setSuburb(place.suburb() != null ? place.suburb() : "");
        cafe.setAddress(place.address() != null ? place.address() : "");
        cafe.setLat(place.lat());
        cafe.setLng(place.lng());
        cafe.setInstagram(place.instagram());
        cafe.setPriceRange("$$");

        if (analysis != null) {
            // The AI's own level is discarded. The grade is derived from evidence that
            // survives every gate, so a level can never outrun the proof behind it.
            // The page text is searched too, so a weak quote cannot cap the grade.
            TransparencyGrader.Evidence evidence =
                    TransparencyGrader.decide(analysis.evidenceQuote(), scrapedContent);
            TransparencyLevel level = evidence == null ? TransparencyLevel.C : evidence.level();

            cafe.setLevel(level);
            cafe.setType(analysis.type() != null ? analysis.type() : "cafe");
            cafe.setSpecialties(analysis.specialties() != null ? String.join(",", analysis.specialties()) : "");
            cafe.setCoverColor(coverColorForLevel(level.name()));

            if (TransparencyGrader.levelRequiresEvidence(level)) {
                // Level and evidence are written together — never one without the other.
                cafe.setEvidenceQuote(evidence.quote());
                String src = locateQuotePage(evidence.quote(), scrapeResult);
                if (src == null) src = exactSourceUrl != null ? exactSourceUrl : place.website();
                if (src != null && src.length() > 250) src = src.substring(0, 250);
                cafe.setEvidenceSource(src);
                cafe.setEvidenceSourceLabel("Official Website");
                cafe.setEvidenceVerifiedDate(verifiedDate);
                cafe.setTagline(analysis.tagline() != null ? analysis.tagline() : "");
                cafe.setDescription(analysis.description() != null ? analysis.description() : "");
            } else {
                // No qualifying evidence: keep no quote, and no AI prose that might imply
                // a sourcing claim the cafe never actually made.
                cafe.setTagline("");
                cafe.setDescription("");
            }
        } else if (photoEvidence != null) {
            // Nothing was scraped, but a photo on the cafe's own Google Maps listing shows a
            // menu that discloses sourcing — found and graded by MenuPhotoVerifier through
            // the same TransparencyGrader.findBestEvidence gate the website path uses. Labelled
            // separately from "Official Website" below: a customer's photo of a printed menu
            // is real evidence, but not the same authority as the cafe's own site, and this
            // project's whole premise is showing that provenance honestly.
            cafe.setLevel(photoEvidence.level());
            cafe.setType("cafe");
            cafe.setEvidenceQuote(photoEvidence.quote());
            cafe.setEvidenceSource("https://www.google.com/maps/place/?q=place_id:" + place.googleId());
            cafe.setEvidenceSourceLabel("Menu Photo (Google Maps)");
            cafe.setEvidenceVerifiedDate(verifiedDate);
            cafe.setTagline("");
            cafe.setDescription("");
            cafe.setSpecialties("");
            cafe.setCoverColor(coverColorForLevel(photoEvidence.level().name()));
        } else {
            // No content means nothing was ever read — website null, scrape failed, or
            // whatever came back was blank. That is not the same finding as C, which means
            // a page WAS read and it disclosed nothing: C is a confirmed negative, this is
            // an absent measurement. Conflating the two here used to put "no page we could
            // read" and "read the page, said nothing" behind the same label and the same
            // cover colour, which is exactly the distinction the frontend's own level cards
            // already draw ("no public sourcing information on any channel" vs "could not
            // verify enough information") — this just makes the backend agree with it.
            cafe.setLevel(TransparencyLevel.D);
            cafe.setType("cafe");
            cafe.setTagline("");
            cafe.setDescription("");
            cafe.setSpecialties("");
            cafe.setCoverColor(coverColorForLevel(TransparencyLevel.D.name()));
        }

        if (place.website() != null) {
            String w = place.website().replaceFirst("^https?://", "").replaceAll("/$", "");
            cafe.setWebsite(w.length() > 250 ? w.substring(0, 250) : w);
        }

        return cafe;
    }

    /**
     * Scrub all existing cafes: re-scrape their website, verify the stored evidence quote
     * actually appears verbatim. If not found, clear the quote and downgrade level to C.
     * Returns a summary map with counts of fixed, verified, and skipped cafes.
     */
    public Map<String, Object> cleanupEvidenceQuotes() {
        // Audit every record that CLAIMS a disclosure (A or B) plus every record that holds a
        // quote at any level. The old filter looked only at rows that already had a quote,
        // which made an unsupported Level A invisible to the very pass meant to catch it.
        List<Cafe> cafes = cafeRepository.findAll().stream()
                .filter(c -> TransparencyGrader.levelRequiresEvidence(c.getLevel())
                        || (c.getEvidenceQuote() != null && !c.getEvidenceQuote().isBlank()))
                .toList();

        int verified = 0, fixed = 0, skipped = 0;

        for (Cafe cafe : cafes) {
            // No quote but claiming A or B — unsupported by construction. Downgrade without
            // needing a network call at all.
            if (cafe.getEvidenceQuote() == null || cafe.getEvidenceQuote().isBlank()) {
                System.out.printf("[Cleanup] Level %s with no evidence — downgrading '%s' to C%n",
                        cafe.getLevel(), cafe.getName());
                demoteToC(cafe);
                fixed++;
                continue;
            }

            String url = cafe.getEvidenceSource() != null ? cafe.getEvidenceSource() : cafe.getWebsite();
            if (url == null || url.isBlank()) { skipped++; continue; }
            if (!url.startsWith("http")) url = "https://" + url;

            try {
                ScraperService.ScrapeResult scrapeResult = scraperService.scrapeWithTracking(url);
                if (scrapeResult == null || scrapeResult.combinedText().isBlank()) { skipped++; continue; }

                String quote = cafe.getEvidenceQuote();

                // Gate 2 — the quote must still exist on the live page.
                if (!TransparencyGrader.appearsVerbatim(quote, scrapeResult.combinedText())) {
                    System.out.printf("[Cleanup] Hallucinated quote removed from '%s': \"%s\"%n",
                            cafe.getName(), quote.substring(0, Math.min(80, quote.length())));
                    demoteToC(cafe);
                    fixed++;
                    sleep(500);
                    continue;
                }

                // Gates 3-6 — re-derive the grade from what the quote actually proves.
                TransparencyLevel regraded = TransparencyGrader.gradeVerifiedQuote(quote);

                if (regraded != cafe.getLevel()) {
                    System.out.printf("[Cleanup] Re-graded '%s': %s → %s (\"%s\")%n",
                            cafe.getName(), cafe.getLevel(), regraded,
                            quote.substring(0, Math.min(70, quote.length())));

                    if (regraded == TransparencyLevel.C || regraded == TransparencyLevel.D) {
                        demoteToC(cafe);
                    } else {
                        cafe.setLevel(regraded);
                        cafe.setCoverColor(coverColorForLevel(regraded.name()));
                        cafeRepository.save(cafe);
                    }
                    fixed++;
                    sleep(500);
                    continue;
                }

                // Grade holds — refresh the source URL to the exact page carrying the quote.
                String exactPage = findQuoteSourcePage(
                    new OpenAiService.CafeAnalysis(true, cafe.getLevel().name(), quote, null, null, List.of(), null),
                    scrapeResult
                );
                if (exactPage != null && !exactPage.equals(cafe.getEvidenceSource())) {
                    cafe.setEvidenceSource(exactPage.length() > 250 ? exactPage.substring(0, 250) : exactPage);
                    cafeRepository.save(cafe);
                    System.out.printf("[Cleanup] Updated source URL for '%s': %s%n", cafe.getName(), exactPage);
                }
                verified++;
                sleep(500);
            } catch (Exception e) {
                System.out.printf("[Cleanup] Could not scrape '%s': %s%n", cafe.getName(), e.getMessage());
                skipped++;
            }
        }

        // Also clear descriptions on C/D cafes that still reference specific Japanese origins
        // (these were demoted but descriptions weren't cleared in the first pass)
        List<String> originKeywords = List.of("uji", "yame", "kagoshima", "nishio", "shizuoka", "kyoto",
                "fukuoka", "izumo", "single-origin", "single origin", "directly from");
        int descFixed = 0;
        for (Cafe cafe : cafeRepository.findAll()) {
            if (cafe == null) continue;
            if (cafe.getLevel() != TransparencyLevel.C && cafe.getLevel() != TransparencyLevel.D) continue;
            if (cafe.getDescription() == null) continue;
            String descLower = cafe.getDescription().toLowerCase();
            if (originKeywords.stream().anyMatch(descLower::contains)) {
                cafe.setDescription(null);
                cafe.setTagline(null);
                cafeRepository.save(cafe);
                descFixed++;
                System.out.printf("[Cleanup] Cleared misleading description from '%s'%n", cafe.getName());
            }
        }

        System.out.printf("[Cleanup] Done. Verified: %d, Fixed: %d, Desc cleared: %d, Skipped: %d%n", verified, fixed, descFixed, skipped);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("verified", verified);
        result.put("fixed", fixed);
        result.put("descriptionsCleaned", descFixed);
        result.put("skipped", skipped);
        return result;
    }

    /**
     * Re-scrape stored cafes and re-derive both level and evidence from what is on the
     * site today.
     *
     * <p>Distinct from {@link #cleanupEvidenceQuotes()}, which can only ever demote: it
     * re-checks the quote already stored and never asks whether the page proves more.
     * This pass searches the page text directly, so a cafe whose disclosure was missed
     * at discovery time can be promoted on the evidence it actually publishes.
     *
     * <p>Level D is preserved unless the site now supports A or B — "not enough
     * information" is a distinct state, not a weaker C.
     *
     * @param levelFilter only regrade cafes at this level, or null for all
     * @param dryRun      when true, nothing is written; the proposed changes are returned
     * @param limit       maximum cafes to process, 0 for no limit
     * @param analyse     when true, cafes holding no quote get one from the analyser, so
     *                    every row is judged on both evidence channels rather than on
     *                    whichever one its level happens to have left it with
     */
    public Map<String, Object> regrade(RegradeOptions opts) {
        Selection selection = select(opts);
        List<Cafe> targets = selection.targets();

        RegradeJournal journal = RegradeJournal.open(opts, selection);
        List<Map<String, Object>> changes = new ArrayList<>();
        int unchanged = 0, skipped = 0;

        int examined = 0;
        for (Cafe cafe : targets) {
            // A full sweep is hours long; without a heartbeat there is no way to tell a
            // slow crawl from a stalled one.
            if (++examined % 25 == 0 || examined == 1) {
                System.out.printf("[Regrade] %d/%d — %d changes, %d unchanged, %d skipped%n",
                        examined, targets.size(), changes.size(), unchanged, skipped);
            }

            SiteContent content;
            try {
                content = gatherContent(cafe);
            } catch (Exception e) {
                System.out.printf("[Regrade] Could not read '%s': %s%n", cafe.getName(), e.getMessage());
                journal.record(cafe, "UNREACHABLE", e.getMessage());
                skipped++;
                continue;
            }
            if (content == null || content.text().isBlank()) {
                journal.record(cafe, "NO-CONTENT", null);
                skipped++;
                continue;
            }

            String url = content.startUrl();
            ScraperService.ScrapeResult scraped =
                    new ScraperService.ScrapeResult(content.text(), content.pageTexts(), List.of());

            // Both channels, for every row. A cafe demoted to C had its quote cleared, so
            // without this the C set would be judged on the page scan alone while the B set
            // that was regraded before it had the analyser's quote as well.
            String aiQuote = cafe.getEvidenceQuote();
            if (opts.analyse() && (aiQuote == null || aiQuote.isBlank())) {
                OpenAiService.CafeAnalysis fresh =
                        openAiService.analyze(cafe.getName(), url, content.text());
                if (fresh != null) aiQuote = fresh.evidenceQuote();
                System.out.printf("[Regrade] %s — analyser %s%n", cafe.getName(),
                        fresh == null ? "unavailable"
                                : aiQuote == null ? "found no quote"
                                : "quoted: \"" + preview(aiQuote) + "\"");
            }

            TransparencyGrader.Evidence evidence =
                    TransparencyGrader.decide(aiQuote, content.text());
            TransparencyLevel proposed = evidence == null ? TransparencyLevel.C : evidence.level();

            // "Insufficient information" is not the same claim as "no disclosure".
            if (cafe.getLevel() == TransparencyLevel.D && !TransparencyGrader.levelRequiresEvidence(proposed)) {
                journal.record(cafe, "HELD-AT-D", null);
                unchanged++;
                sleep(300);
                continue;
            }

            // A published grade is not withdrawn just because this run came back
            // empty-handed. A partial crawl — a page that timed out, a menu that moved
            // behind a script — is indistinguishable from a cafe that deleted its
            // sourcing statement, and only one of those should cost it its grade. Held
            // and recorded, so a person can look rather than the run deciding silently.
            if (TransparencyGrader.levelRequiresEvidence(cafe.getLevel())
                    && evidence == null) {
                System.out.printf("[Regrade] %s — held at %s, this run found no evidence%n",
                        cafe.getName(), cafe.getLevel());
                journal.record(cafe, "NEEDS-REVIEW",
                        "was " + cafe.getLevel() + "; no evidence found this run");
                unchanged++;
                sleep(300);
                continue;
            }

            String newQuote = evidence == null ? null : evidence.quote();
            boolean levelSame = proposed == cafe.getLevel();
            boolean quoteSame = Objects.equals(newQuote, cafe.getEvidenceQuote());
            if (levelSame && quoteSame) {
                journal.record(cafe, "UNCHANGED", null);
                unchanged++;
                sleep(300);
                continue;
            }

            String sourcePage = locateQuotePage(newQuote, scraped);
            Map<String, Object> change = new LinkedHashMap<>();
            change.put("id", cafe.getId());
            change.put("name", cafe.getName());
            change.put("from", cafe.getLevel().name());
            change.put("to", proposed.name());
            change.put("direction", proposed.compareTo(cafe.getLevel()) < 0 ? "PROMOTE"
                    : proposed.compareTo(cafe.getLevel()) > 0 ? "DEMOTE" : "QUOTE-ONLY");
            change.put("oldQuote", cafe.getEvidenceQuote());
            change.put("newQuote", newQuote);
            change.put("sourcePage", sourcePage != null ? sourcePage : url);
            change.put("pagesScraped", scraped.pageTexts().size());

            // Write only what actually happened. Recording the change first meant a save
            // that then failed still left the cafe marked done, and a resumed run skipped
            // it — the change was reported, journalled, and never actually made. The
            // journal is what resume trusts, so it must lag the database, never lead it.
            if (!opts.dryRun()) {
                applyRegrade(cafe, proposed, newQuote, sourcePage != null ? sourcePage : url);
            }
            changes.add(change);
            journal.record(change);
            sleep(300);
        }

        System.out.printf("[Regrade] %s — %d changes, %d unchanged, %d skipped%n",
                opts.dryRun() ? "DRY RUN" : "APPLIED", changes.size(), unchanged, skipped);
        journal.close();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("dryRun", opts.dryRun());
        result.put("journal", journal.path());
        result.put("selected", selection.total());
        result.put("examined", targets.size());
        result.put("excludedUnreachable", selection.excludedUnreachable());
        result.put("alreadyDone", selection.alreadyDone());
        result.put("changed", changes.size());
        result.put("unchanged", unchanged);
        result.put("skipped", skipped);
        result.put("changes", changes);
        return result;
    }

    /** One cafe's page text, read by something other than the built-in crawler. */
    public record RenderedSite(String id, String url, String text) {}

    /**
     * Grade cafes from text captured by the headless renderer.
     *
     * <p>Roughly three quarters of the sites the crawler could not read were not blocking
     * it — they build their pages in the browser and serve an empty shell to anything that
     * cannot run JavaScript. tools/render.mjs opens those in a real browser and writes out
     * what a reader would see; this takes that text through the identical pipeline the
     * crawler's own text goes through, analyser included. Only the source of the words
     * differs, never the standard applied to them.
     */
    public Map<String, Object> regradeFromRenderedText(List<RenderedSite> sites, boolean dryRun,
                                                       boolean analyse) {
        Map<String, Cafe> byId = new LinkedHashMap<>();
        for (Cafe c : cafeRepository.findAll()) byId.put(c.getId(), c);

        RegradeOptions opts = new RegradeOptions(
                "rendered", dryRun, 0, 0, analyse, false, 0, true, null);
        RegradeJournal journal = RegradeJournal.open(opts, new Selection(List.of(), sites.size(), 0, 0));

        List<Map<String, Object>> changes = new ArrayList<>();
        int unchanged = 0, skipped = 0, examined = 0;

        for (RenderedSite site : sites) {
            Cafe cafe = byId.get(site.id());
            if (cafe == null || site.text() == null || site.text().isBlank()) { skipped++; continue; }

            if (++examined % 25 == 0 || examined == 1) {
                System.out.printf("[Rendered] %d/%d — %d changes, %d unchanged, %d skipped%n",
                        examined, sites.size(), changes.size(), unchanged, skipped);
            }

            String aiQuote = cafe.getEvidenceQuote();
            if (analyse && (aiQuote == null || aiQuote.isBlank())) {
                OpenAiService.CafeAnalysis fresh =
                        openAiService.analyze(cafe.getName(), site.url(), site.text());
                if (fresh != null) aiQuote = fresh.evidenceQuote();
            }

            TransparencyGrader.Evidence evidence = TransparencyGrader.decide(aiQuote, site.text());
            TransparencyLevel proposed = evidence == null ? TransparencyLevel.C : evidence.level();

            if (cafe.getLevel() == TransparencyLevel.D
                    && !TransparencyGrader.levelRequiresEvidence(proposed)) {
                journal.record(cafe, "HELD-AT-D", null);
                unchanged++;
                continue;
            }
            if (TransparencyGrader.levelRequiresEvidence(cafe.getLevel()) && evidence == null) {
                journal.record(cafe, "NEEDS-REVIEW", "was " + cafe.getLevel() + "; rendered text held no evidence");
                unchanged++;
                continue;
            }

            String newQuote = evidence == null ? null : evidence.quote();
            if (proposed == cafe.getLevel() && Objects.equals(newQuote, cafe.getEvidenceQuote())) {
                journal.record(cafe, "UNCHANGED", null);
                unchanged++;
                continue;
            }

            Map<String, Object> change = new LinkedHashMap<>();
            change.put("id", cafe.getId());
            change.put("name", cafe.getName());
            change.put("from", cafe.getLevel().name());
            change.put("to", proposed.name());
            change.put("direction", proposed.compareTo(cafe.getLevel()) < 0 ? "PROMOTE"
                    : proposed.compareTo(cafe.getLevel()) > 0 ? "DEMOTE" : "QUOTE-ONLY");
            change.put("oldQuote", cafe.getEvidenceQuote());
            change.put("newQuote", newQuote);
            change.put("sourcePage", site.url());
            change.put("via", "rendered");

            // Journalled after the write, so resume can never skip an unsaved change.
            if (!dryRun) applyRegrade(cafe, proposed, newQuote, site.url());
            changes.add(change);
            journal.record(change);
        }

        System.out.printf("[Rendered] %s — %d changes, %d unchanged, %d skipped%n",
                dryRun ? "DRY RUN" : "APPLIED", changes.size(), unchanged, skipped);
        journal.close();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("dryRun", dryRun);
        result.put("journal", journal.path());
        result.put("examined", examined);
        result.put("changed", changes.size());
        result.put("unchanged", unchanged);
        result.put("skipped", skipped);
        result.put("changes", changes);
        return result;
    }

    /** Everything that decides which cafes a run touches. */
    public record RegradeOptions(
            String level, boolean dryRun, int limit, int offset, boolean analyse,
            boolean sample, long seed, boolean includeUnreachable, String resumeFrom) {}

    public record PhotoBackfillOptions(boolean dryRun, int limit, int offset, String resumeFrom) {}

    /**
     * Re-checks cafes stored before photo verification existed — {@link #cannotBeRead}, same
     * pool {@code regrade}'s {@code includeUnreachable=false} already excludes — against their
     * Google Maps menu photos. Unlike {@link #discoverAndSave}, none of these rows have a
     * {@code googleId} yet, so each candidate costs one fresh Places Text Search lookup to
     * recover it: the same request type discovery already spends against, at Google's
     * standard Text Search price. That lookup is <em>not</em> covered by
     * {@link ApiBudgetGuard}'s free-tier Photo/vision ceilings — only the photo fetch and
     * vision call after it are.
     *
     * <p>Defaults to a dry run and is journaled the same way {@link #regrade} is, so a sweep
     * of hundreds of cafes can be reviewed before anything is written and resumed if
     * interrupted.
     */
    public Map<String, Object> backfillPhotoVerification(PhotoBackfillOptions options) {
        List<Cafe> candidates = cafeRepository.findAll().stream()
                .filter(this::cannotBeRead)
                .sorted(Comparator.comparing(Cafe::getId))
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));

        int pool = candidates.size();
        Set<String> alreadyDone = readJournalIds(options.resumeFrom());
        if (!alreadyDone.isEmpty()) candidates.removeIf(c -> alreadyDone.contains(c.getId()));

        List<Cafe> targets = candidates.stream()
                .skip(Math.max(0, options.offset()))
                .limit(options.limit() > 0 ? options.limit() : Long.MAX_VALUE)
                .toList();

        System.out.printf("[PhotoBackfill] selected %d of %d unreadable cafes (dryRun=%b)%n",
                targets.size(), pool, options.dryRun());

        java.io.PrintWriter journal = openBackfillJournal(options);
        int found = 0, notFound = 0, noEvidence = 0;
        String verifiedDate = LocalDate.now().format(DateTimeFormatter.ofPattern("MMMM yyyy"));

        try {
            for (Cafe cafe : targets) {
                GooglePlacesService.PlaceInfo place = googlePlacesService.findPlaceByNameAndAddress(
                        cafe.getName(), cafe.getAddress(), cafe.getLat(), cafe.getLng());

                if (place == null) {
                    writeBackfillRow(journal, cafe, "NOT-FOUND", null);
                    notFound++;
                    sleep(500);
                    continue;
                }

                if (!options.dryRun() && !place.googleId().equals(cafe.getGoogleId())) {
                    cafe.setGoogleId(place.googleId());
                    cafeRepository.save(cafe);
                }

                MenuPhotoVerifier.PhotoEvidence evidence = menuPhotoVerifier.verify(place).orElse(null);

                if (evidence == null) {
                    writeBackfillRow(journal, cafe, "NO-EVIDENCE", null);
                    noEvidence++;
                    sleep(500);
                    continue;
                }

                System.out.printf("[PhotoBackfill] → '%s': %s → %s from a menu photo%n",
                        cafe.getName(), cafe.getLevel(), evidence.level());
                writeBackfillRow(journal, cafe, "FOUND", evidence.level().name() + ": " + evidence.quote());
                found++;

                if (!options.dryRun()) {
                    cafe.setLevel(evidence.level());
                    cafe.setEvidenceQuote(evidence.quote());
                    cafe.setEvidenceSource("https://www.google.com/maps/place/?q=place_id:" + place.googleId());
                    cafe.setEvidenceSourceLabel("Menu Photo (Google Maps)");
                    cafe.setEvidenceVerifiedDate(verifiedDate);
                    cafe.setCoverColor(coverColorForLevel(evidence.level().name()));
                    cafeRepository.save(cafe);
                }
                sleep(500);
            }
        } finally {
            if (journal != null) journal.close();
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("pool", pool);
        summary.put("selected", targets.size());
        summary.put("found", found);
        summary.put("noEvidence", noEvidence);
        summary.put("notFound", notFound);
        summary.put("dryRun", options.dryRun());
        summary.put("usage", budgetGuard.snapshot());
        System.out.printf("[PhotoBackfill] Done. found=%d noEvidence=%d notFound=%d (dryRun=%b)%n",
                found, noEvidence, notFound, options.dryRun());
        return summary;
    }

    public record WebsiteImageBackfillOptions(boolean dryRun, int limit, int offset, String resumeFrom) {}

    /**
     * Re-checks Level C cafes that DO have a reachable website — the opposite pool from
     * {@link #backfillPhotoVerification}, which targets cafes with no reachable content at
     * all. Some sites put their sourcing story in a banner or brand-story graphic instead
     * of real text, which {@link ScraperService}'s text-only scrape never sees. Re-scrapes
     * each cafe (free — the same request the text scraper already makes) and checks any
     * images the page carries via {@link WebsiteImageVerifier}.
     *
     * <p>Defaults to a dry run and is journaled the same way {@link #regrade} is.
     */
    public Map<String, Object> backfillWebsiteImages(WebsiteImageBackfillOptions options) {
        List<Cafe> candidates = cafeRepository.findAll().stream()
                .filter(c -> c.getLevel() == TransparencyLevel.C)
                .filter(c -> !cannotBeRead(c))
                .sorted(Comparator.comparing(Cafe::getId))
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));

        int pool = candidates.size();
        Set<String> alreadyDone = readJournalIds(options.resumeFrom());
        if (!alreadyDone.isEmpty()) candidates.removeIf(c -> alreadyDone.contains(c.getId()));

        List<Cafe> targets = candidates.stream()
                .skip(Math.max(0, options.offset()))
                .limit(options.limit() > 0 ? options.limit() : Long.MAX_VALUE)
                .toList();

        System.out.printf("[ImageBackfill] selected %d of %d reachable Level C cafes (dryRun=%b)%n",
                targets.size(), pool, options.dryRun());

        java.io.PrintWriter journal = openImageBackfillJournal(options);
        int found = 0, noImages = 0, noEvidence = 0, unreachable = 0;
        String verifiedDate = LocalDate.now().format(DateTimeFormatter.ofPattern("MMMM yyyy"));

        try {
            for (Cafe cafe : targets) {
                String website = cafe.getWebsite();
                if (website == null || website.isBlank()) {
                    writeBackfillRow(journal, cafe, "UNREACHABLE", null);
                    unreachable++;
                    continue;
                }

                ScraperService.ScrapeResult scraped;
                try {
                    scraped = scraperService.scrapeWithTracking(withScheme(website));
                } catch (Exception e) {
                    writeBackfillRow(journal, cafe, "UNREACHABLE", e.getMessage());
                    unreachable++;
                    continue;
                }

                if (scraped == null || scraped.imageUrls().isEmpty()) {
                    writeBackfillRow(journal, cafe, "NO-IMAGES", null);
                    noImages++;
                    sleep(500);
                    continue;
                }

                WebsiteImageVerifier.ImageEvidence evidence =
                        websiteImageVerifier.verify(scraped.imageUrls()).orElse(null);

                if (evidence == null) {
                    writeBackfillRow(journal, cafe, "NO-EVIDENCE", null);
                    noEvidence++;
                    sleep(500);
                    continue;
                }

                System.out.printf("[ImageBackfill] → '%s': %s → %s from a website image%n",
                        cafe.getName(), cafe.getLevel(), evidence.level());
                writeBackfillRow(journal, cafe, "FOUND", evidence.level().name() + ": " + evidence.quote());
                found++;

                if (!options.dryRun()) {
                    cafe.setLevel(evidence.level());
                    cafe.setEvidenceQuote(evidence.quote());
                    String src = evidence.imageUrl();
                    cafe.setEvidenceSource(src.length() > 250 ? src.substring(0, 250) : src);
                    cafe.setEvidenceSourceLabel("Website Image");
                    cafe.setEvidenceVerifiedDate(verifiedDate);
                    cafe.setCoverColor(coverColorForLevel(evidence.level().name()));
                    cafeRepository.save(cafe);
                }
                sleep(500);
            }
        } finally {
            if (journal != null) journal.close();
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("pool", pool);
        summary.put("selected", targets.size());
        summary.put("found", found);
        summary.put("noEvidence", noEvidence);
        summary.put("noImages", noImages);
        summary.put("unreachable", unreachable);
        summary.put("dryRun", options.dryRun());
        summary.put("usage", budgetGuard.snapshot());
        System.out.printf("[ImageBackfill] Done. found=%d noEvidence=%d noImages=%d unreachable=%d (dryRun=%b)%n",
                found, noEvidence, noImages, unreachable, options.dryRun());
        return summary;
    }

    private java.io.PrintWriter openImageBackfillJournal(WebsiteImageBackfillOptions options) {
        try {
            java.nio.file.Path dir = java.nio.file.Path.of("data", "regrade-runs");
            java.nio.file.Files.createDirectories(dir);
            String stamp = LocalDate.now() + "-" + System.currentTimeMillis();
            java.nio.file.Path file = dir.resolve(
                    "image-backfill-" + (options.dryRun() ? "dry" : "applied") + "-" + stamp + ".jsonl");
            var writer = new java.io.PrintWriter(java.nio.file.Files.newBufferedWriter(file), true);
            System.out.printf("[ImageBackfill] journal: %s%n", file);
            return writer;
        } catch (Exception e) {
            System.out.printf("[ImageBackfill] journal unavailable (%s) — continuing without one%n", e.getMessage());
            return null;
        }
    }

    private java.io.PrintWriter openBackfillJournal(PhotoBackfillOptions options) {
        try {
            java.nio.file.Path dir = java.nio.file.Path.of("data", "regrade-runs");
            java.nio.file.Files.createDirectories(dir);
            String stamp = LocalDate.now() + "-" + System.currentTimeMillis();
            java.nio.file.Path file = dir.resolve(
                    "photo-backfill-" + (options.dryRun() ? "dry" : "applied") + "-" + stamp + ".jsonl");
            var writer = new java.io.PrintWriter(java.nio.file.Files.newBufferedWriter(file), true);
            System.out.printf("[PhotoBackfill] journal: %s%n", file);
            return writer;
        } catch (Exception e) {
            System.out.printf("[PhotoBackfill] journal unavailable (%s) — continuing without one%n", e.getMessage());
            return null;
        }
    }

    private void writeBackfillRow(java.io.PrintWriter journal, Cafe cafe, String outcome, String detail) {
        if (journal == null) return;
        try {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", cafe.getId());
            row.put("name", cafe.getName());
            row.put("from", cafe.getLevel().name());
            row.put("outcome", outcome);
            if (detail != null) row.put("detail", detail);
            journal.println(JSON.writeValueAsString(row));
        } catch (Exception ignored) {
            // A journal failure must never take the sweep down with it.
        }
    }

    private record Selection(List<Cafe> targets, int total, int excludedUnreachable, int alreadyDone) {}

    /**
     * Choose the cafes to run against.
     *
     * <p>Ordering by id alone made {@code limit} useless as a sample: ids sort city-first,
     * so the first hundred were a single contiguous Melbourne discovery batch every time.
     * {@code sample=true} shuffles under a caller-supplied seed instead, which is both
     * representative and reproducible — the same seed and offset return the same cafes,
     * so a run can be repeated or extended without re-drawing the sample.
     */
    private Selection select(RegradeOptions opts) {
        List<Cafe> all = cafeRepository.findAll().stream()
                .filter(c -> opts.level() == null || opts.level().isBlank()
                        || c.getLevel() == TransparencyLevel.valueOf(opts.level().toUpperCase()))
                .sorted(Comparator.comparing(Cafe::getId))
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));

        int before = all.size();
        if (!opts.includeUnreachable()) all.removeIf(this::cannotBeRead);
        int excluded = before - all.size();

        Set<String> done = readJournalIds(opts.resumeFrom());
        int alreadyDone = 0;
        if (!done.isEmpty()) {
            int n = all.size();
            all.removeIf(c -> done.contains(c.getId()));
            alreadyDone = n - all.size();
        }

        if (opts.sample()) Collections.shuffle(all, new Random(opts.seed()));

        int total = all.size();
        List<Cafe> targets = all.stream()
                .skip(Math.max(0, opts.offset()))
                .limit(opts.limit() > 0 ? opts.limit() : Long.MAX_VALUE)
                .toList();

        System.out.printf("[Regrade] selected %d of %d (excluded %d unreadable, %d already journalled)%n",
                targets.size(), before, excluded, alreadyDone);
        return new Selection(targets, total, excluded, alreadyDone);
    }

    /**
     * Hosts that cannot yield sourcing text however long the crawler is given: a record
     * with nothing to fetch, a platform that serves a login wall, or a delivery listing
     * that carries a menu but never a sourcing claim. Excluded by default so an hours-long
     * sweep spends its time on cafes that can actually move, and counted in the result so
     * they are reported rather than quietly folded into "no disclosure".
     *
     * <p>Instagram is on the list on measured grounds rather than assumed ones: across a
     * random sample of the Level C pool, every one of 32 profiles returned nothing at all.
     * The bio path in {@link #gatherContent} is still there and still correct — Instagram
     * simply does not serve it to a server-side client. Pass includeUnreachable=true to
     * try them anyway.
     */
    private static final List<String> UNREADABLE_HOSTS = List.of(
            "instagram.com", "facebook.com", "fb.com",
            "ubereats.com", "doordash.com", "menulog.com.au");

    private boolean cannotBeRead(Cafe cafe) {
        String website = cafe.getWebsite();
        boolean noWebsite = website == null || website.isBlank();
        boolean noInstagram = cafe.getInstagram() == null || cafe.getInstagram().isBlank();
        if (noWebsite && noInstagram) return true;
        if (noWebsite) return false;
        String host = withScheme(website).toLowerCase();
        return UNREADABLE_HOSTS.stream().anyMatch(host::contains);
    }

    /** Cafe ids already processed by an earlier run, so a resumed sweep does not repeat them. */
    private Set<String> readJournalIds(String journalPath) {
        if (journalPath == null || journalPath.isBlank()) return Set.of();
        try {
            Set<String> ids = new LinkedHashSet<>();
            for (String line : java.nio.file.Files.readAllLines(java.nio.file.Path.of(journalPath))) {
                if (line.isBlank()) continue;
                com.fasterxml.jackson.databind.JsonNode n = JSON.readTree(line);
                if (n.hasNonNull("id")) ids.add(n.get("id").asText());
            }
            System.out.printf("[Regrade] resuming — %d cafes already recorded in %s%n", ids.size(), journalPath);
            return ids;
        } catch (Exception e) {
            System.out.printf("[Regrade] could not read journal %s: %s%n", journalPath, e.getMessage());
            return Set.of();
        }
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();

    /**
     * An append-as-you-go record of every cafe a run touched.
     *
     * <p>A full sweep takes hours and previously existed only as the response body of a
     * single HTTP request: a dropped connection discarded the whole crawl, and a dry run
     * left nothing behind to audit. Each line is flushed as it is written, so the file is
     * complete up to the moment of any interruption and can be fed back as
     * {@code resumeFrom}.
     */
    private static final class RegradeJournal {
        private final java.io.PrintWriter out;
        private final String path;

        private RegradeJournal(java.io.PrintWriter out, String path) {
            this.out = out;
            this.path = path;
        }

        static RegradeJournal open(RegradeOptions opts, Selection selection) {
            try {
                java.nio.file.Path dir = java.nio.file.Path.of("data", "regrade-runs");
                java.nio.file.Files.createDirectories(dir);
                String stamp = LocalDate.now() + "-" + System.currentTimeMillis();
                java.nio.file.Path file = dir.resolve(
                        "regrade-" + (opts.level() == null ? "all" : opts.level().toLowerCase())
                                + (opts.dryRun() ? "-dry" : "-applied") + "-" + stamp + ".jsonl");
                var writer = new java.io.PrintWriter(java.nio.file.Files.newBufferedWriter(file), true);
                RegradeJournal journal = new RegradeJournal(writer, file.toString());
                journal.write(Map.of("event", "start", "options", opts.toString(),
                        "selected", selection.targets().size(), "pool", selection.total()));
                System.out.printf("[Regrade] journal: %s%n", file);
                return journal;
            } catch (Exception e) {
                System.out.printf("[Regrade] journal unavailable (%s) — continuing without one%n", e.getMessage());
                return new RegradeJournal(null, null);
            }
        }

        void record(Cafe cafe, String outcome, String detail) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", cafe.getId());
            row.put("name", cafe.getName());
            row.put("from", cafe.getLevel().name());
            row.put("outcome", outcome);
            if (detail != null) row.put("detail", detail);
            write(row);
        }

        void record(Map<String, Object> change) {
            Map<String, Object> row = new LinkedHashMap<>(change);
            row.put("outcome", "CHANGE");
            write(row);
        }

        private void write(Map<String, Object> row) {
            if (out == null) return;
            try {
                out.println(JSON.writeValueAsString(row));
            } catch (Exception ignored) {
                // A journal failure must never take the crawl down with it.
            }
        }

        void close() { if (out != null) out.close(); }

        String path() { return path; }
    }

    /**
     * Write a set of changes that has already been read and approved.
     *
     * <p>Re-running the sweep with {@code dryRun=false} would write a fresh set rather
     * than the reviewed one: crawls vary between runs — a cafe whose sourcing page was
     * reached on Tuesday may only yield its menu on Wednesday — so what lands in the
     * database would not be what was checked. This takes the reviewed file instead.
     *
     * <p>Every quote is graded again on the way in and must still produce the level the
     * file claims. A journal accumulated across several runs can hold verdicts from a
     * build whose gates were looser, and those must not reach the site on the strength of
     * having once been written down.
     */
    public Map<String, Object> applyReviewedChanges(String path, boolean dryRun) {
        List<Map<String, Object>> applied = new ArrayList<>();
        List<Map<String, Object>> rejected = new ArrayList<>();

        List<com.fasterxml.jackson.databind.JsonNode> entries;
        try {
            com.fasterxml.jackson.databind.JsonNode root =
                    JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(path)));
            entries = new ArrayList<>();
            root.forEach(entries::add);
        } catch (Exception e) {
            return Map.of("error", "could not read " + path + ": " + e.getMessage());
        }

        for (com.fasterxml.jackson.databind.JsonNode entry : entries) {
            String id = entry.path("id").asText(null);
            String quote = entry.hasNonNull("newQuote") ? entry.get("newQuote").asText() : null;
            String claimed = entry.path("to").asText(null);
            if (id == null || claimed == null) continue;

            Map<String, Object> note = new LinkedHashMap<>();
            note.put("id", id);
            note.put("to", claimed);

            Optional<Cafe> found = cafeRepository.findById(id);
            if (found.isEmpty()) {
                note.put("reason", "no such cafe");
                rejected.add(note);
                continue;
            }

            // The grade must follow from the quote now, not merely have followed once.
            TransparencyGrader.Evidence evidence = TransparencyGrader.decide(null, quote);
            TransparencyLevel derived = evidence == null ? TransparencyLevel.C : evidence.level();
            if (!derived.name().equals(claimed)) {
                note.put("reason", "grader now derives " + derived + " from this quote");
                rejected.add(note);
                continue;
            }

            Cafe cafe = found.get();
            note.put("name", cafe.getName());
            note.put("from", cafe.getLevel().name());
            applied.add(note);
            if (!dryRun) {
                applyRegrade(cafe, derived, quote,
                        entry.path("sourcePage").asText(cafe.getWebsite()));
            }
        }

        System.out.printf("[Apply] %s — %d written, %d rejected%n",
                dryRun ? "DRY RUN" : "APPLIED", applied.size(), rejected.size());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("dryRun", dryRun);
        result.put("applied", applied.size());
        result.put("rejected", rejected.size());
        result.put("appliedRows", applied);
        result.put("rejectedRows", rejected);
        return result;
    }

    private void applyRegrade(Cafe cafe, TransparencyLevel level, String quote, String sourcePage) {
        if (!TransparencyGrader.levelRequiresEvidence(level)) {
            demoteToC(cafe);
            return;
        }
        cafe.setLevel(level);
        cafe.setCoverColor(coverColorForLevel(level.name()));
        cafe.setEvidenceQuote(quote);
        cafe.setEvidenceSource(sourcePage.length() > 250 ? sourcePage.substring(0, 250) : sourcePage);
        cafe.setEvidenceSourceLabel("Official Website");
        cafe.setEvidenceVerifiedDate(LocalDate.now().format(DateTimeFormatter.ofPattern("MMMM yyyy")));
        cafeRepository.save(cafe);
    }

    /** Everything readable about one cafe, and which page each part came from. */
    private record SiteContent(String startUrl, String text, Map<String, String> pageTexts) {}

    /**
     * Read a cafe the way discovery reads one: its website <em>and</em> its Instagram bio.
     *
     * <p>Regrading previously took the website alone. That mattered most for the records
     * whose website field <em>is</em> a profile link — fetching those as an ordinary page
     * returns a login wall, so a cafe assessed at discovery through its bio was reassessed
     * against nothing at all, then left at the level that produced.
     */
    private SiteContent gatherContent(Cafe cafe) {
        Map<String, String> pageTexts = new LinkedHashMap<>();
        StringBuilder combined = new StringBuilder();
        String website = cafe.getWebsite();
        boolean websiteIsProfile = website != null && scraperService.isInstagramUrl(withScheme(website));
        String startUrl = null;

        if (website != null && !website.isBlank() && !websiteIsProfile) {
            startUrl = startUrl(cafe);
            ScraperService.ScrapeResult scraped = scraperService.scrapeWithTracking(startUrl);
            if (scraped != null) {
                combined.append(scraped.combinedText());
                pageTexts.putAll(scraped.pageTexts());
            }
        }

        // The handle proper, or the profile that was filed as a website.
        String handle = cafe.getInstagram();
        if ((handle == null || handle.isBlank()) && websiteIsProfile) handle = website;

        if (handle != null && !handle.isBlank()) {
            String bio = scraperService.scrapeInstagram(handle);
            if (bio != null && !bio.isBlank()) {
                combined.append(' ').append(bio);
                String profileUrl = scraperService.instagramProfileUrl(handle);
                if (profileUrl != null) {
                    pageTexts.put(profileUrl, bio);
                    if (startUrl == null) startUrl = profileUrl;
                }
            }
        }

        if (startUrl == null) return null;
        return new SiteContent(startUrl, combined.toString().replaceAll("\\s+", " ").strip(), pageTexts);
    }

    private String withScheme(String url) {
        return url.startsWith("http") ? url : "https://" + url;
    }

    /** Enough of a quote to recognise it in a log without flooding the line. */
    private String preview(String s) {
        String flat = s.replaceAll("\\s+", " ").strip();
        return flat.length() <= 70 ? flat : flat.substring(0, 70) + "…";
    }

    /**
     * Always start from the site root so the crawler sees the full navigation and can
     * rank pages itself. Stored websites are sometimes a deep link — starting from
     * "jsytea.com.au/pages/contact" reached two pages, because a contact page links
     * almost nowhere.
     */
    private String startUrl(Cafe cafe) {
        String w = cafe.getWebsite();
        if (w == null || w.isBlank()) return null;
        String full = w.startsWith("http") ? w : "https://" + w;
        try {
            java.net.URI u = java.net.URI.create(full);
            if (u.getHost() != null) {
                return (u.getScheme() != null ? u.getScheme() : "https") + "://" + u.getHost();
            }
        } catch (Exception ignored) {
            // fall through to the stored value
        }
        return full;
    }

    /**
     * Find which specific page the evidence quote was found on.
     * Returns the exact subpage URL, or the homepage URL if found there, or null.
     */
    private String findQuoteSourcePage(OpenAiService.CafeAnalysis analysis, ScraperService.ScrapeResult scrapeResult) {
        return analysis == null ? null : locateQuotePage(analysis.evidenceQuote(), scrapeResult);
    }

    /** Which scraped page carries this quote, by leading fingerprint. Null if none does. */
    private String locateQuotePage(String quote, ScraperService.ScrapeResult scrapeResult) {
        if (quote == null || quote.isBlank() || scrapeResult == null) return null;
        String fingerprint = quote.replaceAll("\\s+", " ").toLowerCase().strip();
        fingerprint = fingerprint.length() > 60 ? fingerprint.substring(0, 60) : fingerprint;
        for (Map.Entry<String, String> entry : scrapeResult.pageTexts().entrySet()) {
            String normPage = entry.getValue().replaceAll("\\s+", " ").toLowerCase();
            if (normPage.contains(fingerprint)) return entry.getKey();
        }
        return null;
    }

    /**
     * Strip a cafe back to Level C: no quote, no source, no AI prose that might imply a
     * sourcing claim the cafe never made. Used whenever evidence fails any gate.
     */
    private void demoteToC(Cafe cafe) {
        cafe.setLevel(TransparencyLevel.C);
        cafe.setCoverColor(coverColorForLevel("C"));
        cafe.setEvidenceQuote(null);
        cafe.setEvidenceSource(null);
        cafe.setEvidenceSourceLabel(null);
        cafe.setEvidenceVerifiedDate(null);
        cafe.setDescription(null);
        cafe.setTagline(null);
        cafeRepository.save(cafe);
    }

    private String coverColorForLevel(String level) {
        if (level == null) return "#9ca3af";
        return switch (level) {
            // Level A is the thick, saturated green used across the app for a fully
            // verified disclosure. Level B previously reused a near-identical dark
            // green (#3a7a30), which made "Mentioned" cards indistinguishable from
            // "Verified" ones at a glance — switched to the lighter green already
            // used for Level B elsewhere (e.g. the "Japanese matcha mentioned" tone
            // on the landing page) so the two levels read as visually distinct.
            case "A" -> "#2e6027";
            case "B" -> "#6eb35c";
            case "C" -> "#9ca3af";
            default  -> "#d1d5db";
        };
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

}
