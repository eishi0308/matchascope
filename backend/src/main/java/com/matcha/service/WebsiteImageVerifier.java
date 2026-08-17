package com.matcha.service;

import com.matcha.model.TransparencyLevel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * Checks the images on a cafe's own website for a sourcing disclosure the text scraper
 * missed — a brand-story banner, an ingredient callout, a certificate — for cafes stuck at
 * Level C despite having a real, reachable site.
 *
 * <p>Unlike {@link MenuPhotoVerifier}, fetching the images themselves costs nothing extra:
 * they're pulled from the same page {@link ScraperService} already fetched for text, via
 * plain HTTP, not a billed Google API. Only the OpenAI vision call is metered, through the
 * same {@link ApiBudgetGuard} meter {@link MenuPhotoVerifier} shares.
 *
 * <p>Same anti-hallucination shape as the other two evidence sources: OCR only transcribes,
 * and {@link TransparencyGrader#findBestEvidence(String)} — unmodified — is what decides
 * whether the transcription proves anything.
 */
@Service
public class WebsiteImageVerifier {

    @Autowired
    private OpenAiService openAiService;

    @Autowired
    private ApiBudgetGuard budgetGuard;

    @Value("${photoverify.maxImagesPerCafe:6}")
    private int maxImagesPerCafe;

    // Same conservative per-image estimate MenuPhotoVerifier charges the guard before the
    // real usage is known.
    private static final long ESTIMATED_INPUT_TOKENS_PER_IMAGE  = 1500;
    private static final long ESTIMATED_OUTPUT_TOKENS_PER_IMAGE = 500;

    public record ImageEvidence(String quote, TransparencyLevel level, String imageUrl) {}

    public WebsiteImageVerifier() {}

    /** Test-only seam — production wiring always goes through the no-arg constructor + @Autowired. */
    WebsiteImageVerifier(OpenAiService openAiService, ApiBudgetGuard budgetGuard, int maxImagesPerCafe) {
        this.openAiService = openAiService;
        this.budgetGuard = budgetGuard;
        this.maxImagesPerCafe = maxImagesPerCafe;
    }

    /**
     * Checks up to {@code maxImagesPerCafe} images, stopping at the first one that
     * discloses sourcing. Returns empty — never throws — whenever an image has no
     * relevant text, discloses nothing, or the shared OpenAI budget runs out mid-loop.
     */
    public Optional<ImageEvidence> verify(List<String> imageUrls) {
        if (imageUrls == null || imageUrls.isEmpty()) return Optional.empty();

        int limit = Math.min(imageUrls.size(), maxImagesPerCafe);

        for (String imageUrl : imageUrls.subList(0, limit)) {
            if (!budgetGuard.tryConsumeOpenAiVision(ESTIMATED_INPUT_TOKENS_PER_IMAGE, ESTIMATED_OUTPUT_TOKENS_PER_IMAGE)) {
                return Optional.empty();
            }

            OpenAiService.ImageOcrResult ocr = openAiService.classifyAndOcrWebsiteImage(imageUrl);
            if (!ocr.hasText() || ocr.ocrText() == null || ocr.ocrText().isBlank()) continue;

            TransparencyGrader.Evidence evidence = TransparencyGrader.findBestEvidence(ocr.ocrText());
            if (evidence != null) {
                return Optional.of(new ImageEvidence(evidence.quote(), evidence.level(), imageUrl));
            }
        }

        return Optional.empty();
    }
}
