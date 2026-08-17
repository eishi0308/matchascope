package com.matcha.service;

import com.matcha.model.TransparencyLevel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * Checks a cafe's Google Maps photos for a menu/price board disclosing matcha sourcing, for
 * cafes {@link CafeService#discoverAndSave} would otherwise grade Level D — no website, no
 * readable Instagram, nothing scraped.
 *
 * <p>Deliberately reuses {@link TransparencyGrader#findBestEvidence} unmodified rather than
 * introducing separate grading logic for photo evidence: a menu photo can only produce a
 * grade if a whitelisted origin token survives OCR intact, the same conservative gate that
 * already protects the website path. OCR errors can therefore only cost a missed disclosure,
 * never fabricate one.
 */
@Service
public class MenuPhotoVerifier {

    @Autowired
    private GooglePlacesService googlePlacesService;

    @Autowired
    private OpenAiService openAiService;

    @Autowired
    private ApiBudgetGuard budgetGuard;

    @Value("${photoverify.maxPhotosPerCafe:4}")
    private int maxPhotosPerCafe;

    @Value("${photoverify.photoMaxWidthPx:1024}")
    private int photoMaxWidthPx;

    // Conservative estimates charged to the budget guard *before* the real usage is known —
    // deliberately on the high side, since overestimating trips the ceiling a little early
    // rather than a little late.
    private static final long ESTIMATED_INPUT_TOKENS_PER_IMAGE  = 1500;
    private static final long ESTIMATED_OUTPUT_TOKENS_PER_IMAGE = 500;

    public record PhotoEvidence(String quote, TransparencyLevel level, String photoName) {}

    public MenuPhotoVerifier() {}

    /** Test-only seam — production wiring always goes through the no-arg constructor + @Autowired. */
    MenuPhotoVerifier(GooglePlacesService googlePlacesService, OpenAiService openAiService,
                       ApiBudgetGuard budgetGuard, int maxPhotosPerCafe, int photoMaxWidthPx) {
        this.googlePlacesService = googlePlacesService;
        this.openAiService = openAiService;
        this.budgetGuard = budgetGuard;
        this.maxPhotosPerCafe = maxPhotosPerCafe;
        this.photoMaxWidthPx = photoMaxWidthPx;
    }

    /**
     * Checks up to {@code maxPhotosPerCafe} of the place's photos, stopping at the first one
     * that discloses matcha sourcing. Returns empty — never throws — whenever a photo can't
     * be fetched, isn't a menu, discloses nothing, or the shared API budget runs out mid-loop;
     * all of those mean "no evidence found here," which the caller already treats the same as
     * "nothing was ever read."
     */
    public Optional<PhotoEvidence> verify(GooglePlacesService.PlaceInfo place) {
        List<String> photoNames = place.photoNames();
        if (photoNames == null || photoNames.isEmpty()) return Optional.empty();

        int limit = Math.min(photoNames.size(), maxPhotosPerCafe);

        for (String photoName : photoNames.subList(0, limit)) {
            if (!budgetGuard.tryConsumePlacesPhotoRequest()) return Optional.empty();

            String photoUri = googlePlacesService.fetchPhotoUri(photoName, photoMaxWidthPx);
            if (photoUri == null) continue; // this photo couldn't be fetched — try the next one

            if (!budgetGuard.tryConsumeOpenAiVision(ESTIMATED_INPUT_TOKENS_PER_IMAGE, ESTIMATED_OUTPUT_TOKENS_PER_IMAGE)) {
                return Optional.empty();
            }

            OpenAiService.PhotoOcrResult ocr = openAiService.classifyAndOcrMenuPhoto(photoUri);
            if (!ocr.isMenu() || ocr.ocrText() == null || ocr.ocrText().isBlank()) continue;

            TransparencyGrader.Evidence evidence = TransparencyGrader.findBestEvidence(ocr.ocrText());
            if (evidence != null) {
                return Optional.of(new PhotoEvidence(evidence.quote(), evidence.level(), photoName));
            }
        }

        return Optional.empty();
    }
}
