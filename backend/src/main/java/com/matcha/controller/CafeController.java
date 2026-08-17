package com.matcha.controller;

import com.matcha.model.CafeResponse;
import com.matcha.service.CafeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/cafes")
public class CafeController {

    @Autowired
    private CafeService cafeService;

    /**
     * GET /api/cafes
     * GET /api/cafes?city=Sydney
     * GET /api/cafes?city=Melbourne&level=A
     */
    @GetMapping
    public ResponseEntity<List<CafeResponse>> getCafes(
            @RequestParam(required = false) String city,
            @RequestParam(required = false) String level
    ) {
        return ResponseEntity.ok(cafeService.findAll(city, level));
    }

    /**
     * GET /api/cafes/{id}
     */
    @GetMapping("/{id}")
    public ResponseEntity<CafeResponse> getCafe(@PathVariable String id) {
        return cafeService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * GET /api/cafes/stats
     * Returns counts per transparency level and per city.
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        return ResponseEntity.ok(cafeService.getStats());
    }

    /**
     * POST /api/cafes/cleanup-evidence
     * Re-scrapes all cafe websites and removes hallucinated evidence quotes.
     */
    @PostMapping("/cleanup-evidence")
    public ResponseEntity<Map<String, Object>> cleanupEvidence() {
        return ResponseEntity.ok(cafeService.cleanupEvidenceQuotes());
    }

    /**
     * POST /api/cafes/regrade?level=C&dryRun=true&limit=100&sample=true&seed=7
     *
     * Re-scrapes stored cafes and re-derives level and evidence from the live site.
     * Unlike cleanup-evidence this can promote as well as demote. Defaults to a dry
     * run so the proposed changes can be reviewed before anything is written.
     *
     * <p>Parameters:
     * <ul>
     *   <li>analyse=false suppresses the per-cafe analyser call for rows holding no
     *       quote. Cheaper, but it grades those rows on the page scan alone — which is
     *       not the bar the rows that kept a quote are held to.</li>
     *   <li>sample=true draws the cafes at random under {@code seed} instead of by id.
     *       Ids sort city-first, so limit alone returns the same Melbourne block every
     *       time and measures that batch rather than the level.</li>
     *   <li>offset skips forward in the selection, so a long sweep can run in chunks.</li>
     *   <li>includeUnreachable=true keeps records with no website, and platforms that
     *       serve no readable text; excluded by default so hours are not spent on rows
     *       that cannot move.</li>
     *   <li>resumeFrom=&lt;journal path&gt; skips cafes an earlier run already recorded.</li>
     * </ul>
     * Every run writes a JSONL journal under data/regrade-runs, flushed per cafe, so an
     * interrupted sweep keeps its work and a dry run leaves something to audit.
     */
    /**
     * POST /api/cafes/regrade-rendered?dryRun=true
     * Body: [{ "id": "...", "url": "...", "text": "..." }, ...]
     *
     * Grades cafes from text captured by tools/render.mjs, which opens sites in a real
     * browser. Most sites the crawler cannot read are not refusing it — they build the
     * page in JavaScript and serve an empty shell. The grading standard is identical to
     * the crawler's; only the means of reading the words differs.
     */
    @PostMapping("/regrade-rendered")
    public ResponseEntity<Map<String, Object>> regradeRendered(
            @RequestBody List<CafeService.RenderedSite> sites,
            @RequestParam(defaultValue = "true") boolean dryRun,
            @RequestParam(defaultValue = "true") boolean analyse
    ) {
        return ResponseEntity.ok(cafeService.regradeFromRenderedText(sites, dryRun, analyse));
    }

    @PostMapping("/regrade")
    public ResponseEntity<Map<String, Object>> regrade(
            @RequestParam(required = false) String level,
            @RequestParam(defaultValue = "true") boolean dryRun,
            @RequestParam(defaultValue = "0") int limit,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "true") boolean analyse,
            @RequestParam(defaultValue = "false") boolean sample,
            @RequestParam(defaultValue = "7") long seed,
            @RequestParam(defaultValue = "false") boolean includeUnreachable,
            @RequestParam(required = false) String resumeFrom
    ) {
        return ResponseEntity.ok(cafeService.regrade(new CafeService.RegradeOptions(
                level, dryRun, limit, offset, analyse, sample, seed, includeUnreachable, resumeFrom)));
    }

    /**
     * POST /api/cafes/apply-regrade?file=data/regrade-runs/final-changes.json&dryRun=false
     *
     * Write a reviewed set of changes. Each quote is graded again on the way in and is
     * refused if it no longer produces the level the file claims, so a verdict recorded
     * by an earlier, looser build cannot reach the site unexamined.
     */
    @PostMapping("/apply-regrade")
    public ResponseEntity<Map<String, Object>> applyRegrade(
            @RequestParam String file,
            @RequestParam(defaultValue = "true") boolean dryRun
    ) {
        return ResponseEntity.ok(cafeService.applyReviewedChanges(file, dryRun));
    }

    /**
     * POST /api/cafes/backfill-photos?dryRun=true&amp;limit=50&amp;offset=0&amp;resumeFrom=...
     *
     * Re-checks cafes stored before photo verification existed (no scrapable website or
     * Instagram) against their Google Maps menu photos. Each candidate costs a fresh Places
     * Text Search lookup (their googleId isn't stored) plus whatever the photo/vision check
     * spends. Defaults to a dry run — nothing is written until dryRun=false.
     */
    @PostMapping("/backfill-photos")
    public ResponseEntity<Map<String, Object>> backfillPhotos(
            @RequestParam(defaultValue = "true") boolean dryRun,
            @RequestParam(defaultValue = "0") int limit,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(required = false) String resumeFrom
    ) {
        return ResponseEntity.ok(cafeService.backfillPhotoVerification(
                new CafeService.PhotoBackfillOptions(dryRun, limit, offset, resumeFrom)));
    }

    /**
     * GET /api/cafes/photo-verify-usage
     * Read-only: how much of the free/budget ceiling the menu-photo verification pipeline
     * has spent this month, and how much remains.
     */
    @GetMapping("/photo-verify-usage")
    public ResponseEntity<Map<String, Object>> getPhotoVerifyUsage() {
        var usage = cafeService.getPhotoVerifyUsage();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("placesUsed", usage.placesUsed());
        result.put("placesCeiling", usage.placesCeiling());
        result.put("placesRemaining", usage.placesCeiling() - usage.placesUsed());
        result.put("openAiSpent", usage.openAiSpent());
        result.put("openAiDollarCeiling", usage.openAiDollarCeiling());
        return ResponseEntity.ok(result);
    }

    /**
     * POST /api/cafes/discover
     * Triggers the full Overpass → scrape → Claude pipeline.
     * This is a long-running operation — expect 5–15 minutes.
     */
    @PostMapping("/discover")
    public ResponseEntity<Map<String, Object>> discoverCafes() {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            int count = cafeService.discoverAndSave();
            result.put("status", "success");
            result.put("discovered", count);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            result.put("status", "error");
            result.put("message", e.getMessage());
            return ResponseEntity.internalServerError().body(result);
        }
    }
}
