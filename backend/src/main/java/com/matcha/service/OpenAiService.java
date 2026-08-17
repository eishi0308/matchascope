package com.matcha.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Service
public class OpenAiService {

    @Value("${openai.api.key:}")
    private String apiKey;

    private final HttpClient   httpClient   = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public record CafeAnalysis(
            boolean servesMatcha,
            String level,
            String evidenceQuote,
            String tagline,
            String description,
            List<String> specialties,
            String type
    ) {}

    /** @param isMenu true if the photo shows a legible menu/price board; ocrText is null when false. */
    public record PhotoOcrResult(boolean isMenu, String ocrText) {}

    /** @param hasText true if the image has legible text worth reading; ocrText is null when false. */
    public record ImageOcrResult(boolean hasText, String ocrText) {}

    /**
     * Send scraped website content to GPT-4o and get a structured matcha transparency analysis.
     */
    public CafeAnalysis analyze(String cafeName, String website, String content) {
        if (apiKey == null || apiKey.isBlank()) {
            System.out.println("[OpenAI] No API key set — skipping AI analysis.");
            return null;
        }

        try {
            String prompt = buildPrompt(cafeName, website, content);

            ObjectNode requestBody = objectMapper.createObjectNode();
            requestBody.put("model", "gpt-4o");
            requestBody.put("max_tokens", 1024);

            ArrayNode messages = requestBody.putArray("messages");
            ObjectNode message = messages.addObject();
            message.put("role", "user");
            message.put("content", prompt);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://api.openai.com/v1/chat/completions"))
                    .header("Content-Type",  "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .timeout(Duration.ofSeconds(60))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(requestBody)))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                System.err.printf("[OpenAI] API error %d: %s%n", response.statusCode(), response.body());
                return null;
            }

            JsonNode responseNode = objectMapper.readTree(response.body());
            String text = responseNode.get("choices").get(0).get("message").get("content").asText().strip();

            return parseAnalysis(text);

        } catch (Exception e) {
            System.err.printf("[OpenAI] Error analyzing %s: %s%n", cafeName, e.getMessage());
            return null;
        }
    }

    /**
     * Classify a Google Maps photo as a menu/price board or not, and if it is, transcribe
     * its text verbatim. Deliberately does not attempt to grade or extract a "quote" here —
     * grading stays exactly {@link TransparencyGrader#findBestEvidence(String)} run on the
     * transcription, the same gate the scraped-website path already uses. Keeping OCR and
     * grading separate means a misread here can only ever cost a missed disclosure, never
     * fabricate one: the whitelist gate still requires its own literal match downstream.
     *
     * <p>Uses gpt-4o-mini rather than {@link #analyze}'s gpt-4o — vision here only has to
     * transcribe text, not reason about sourcing claims, so the cheaper model is enough.
     *
     * @param photoUri a public HTTPS image URL, e.g. from {@link GooglePlacesService#fetchPhotoUri}
     */
    public PhotoOcrResult classifyAndOcrMenuPhoto(String photoUri) {
        JsonNode result = runVisionOcr(photoUri, """
                Is this photo a menu, price list, or price board with legible text
                (printed, handwritten, or a chalkboard)? A photo of food, drinks, decor,
                or people is NOT a menu.

                Respond with ONLY valid JSON — no explanation, no markdown:
                {
                  "isMenu": true,
                  "ocrText": "every word of text visible on the menu, transcribed verbatim, or null"
                }

                CRITICAL: ocrText must be a literal, word-for-word transcription of what is
                printed in the image. Do not paraphrase, summarize, translate, or add words
                that are not visibly in the photo. If any word is unclear, omit it rather
                than guess. If isMenu is false, ocrText must be null.
                """);
        if (result == null) return new PhotoOcrResult(false, null);

        boolean isMenu = result.has("isMenu") && result.get("isMenu").asBoolean();
        String ocrText = getStringOrNull(result, "ocrText");
        return new PhotoOcrResult(isMenu && ocrText != null, isMenu ? ocrText : null);
    }

    /**
     * Classify an image found on a cafe's own website (a banner, brand-story graphic,
     * ingredient callout, certificate) and transcribe any legible text. Same anti-
     * hallucination shape as {@link #classifyAndOcrMenuPhoto}: this only transcribes,
     * grading is still {@link TransparencyGrader#findBestEvidence(String)} on the result.
     */
    public ImageOcrResult classifyAndOcrWebsiteImage(String imageUrl) {
        JsonNode result = runVisionOcr(imageUrl, """
                Does this image contain legible text — a brand-story graphic, an ingredient
                or sourcing callout, a certificate or label, packaging copy? A plain product
                photo, food/drink shot, decor, or logo with no other text does NOT count.

                Respond with ONLY valid JSON — no explanation, no markdown:
                {
                  "hasText": true,
                  "ocrText": "every word of the relevant text, transcribed verbatim, or null"
                }

                CRITICAL: ocrText must be a literal, word-for-word transcription of what is
                printed in the image. Do not paraphrase, summarize, translate, or add words
                that are not visibly in the image. If any word is unclear, omit it rather
                than guess. If hasText is false, ocrText must be null.
                """);
        if (result == null) return new ImageOcrResult(false, null);

        boolean hasText = result.has("hasText") && result.get("hasText").asBoolean();
        String ocrText = getStringOrNull(result, "ocrText");
        return new ImageOcrResult(hasText && ocrText != null, hasText ? ocrText : null);
    }

    /** Shared HTTP/parsing plumbing for a single-image vision call. Null on any failure. */
    private JsonNode runVisionOcr(String imageUrl, String prompt) {
        if (apiKey == null || apiKey.isBlank()) {
            System.out.println("[OpenAI] No API key set — skipping image OCR.");
            return null;
        }

        try {
            ObjectNode requestBody = objectMapper.createObjectNode();
            requestBody.put("model", "gpt-4o-mini");
            requestBody.put("max_tokens", 1024);

            ArrayNode messages = requestBody.putArray("messages");
            ObjectNode message = messages.addObject();
            message.put("role", "user");

            ArrayNode contentParts = message.putArray("content");
            ObjectNode textPart = contentParts.addObject();
            textPart.put("type", "text");
            textPart.put("text", prompt);

            ObjectNode imagePart = contentParts.addObject();
            imagePart.put("type", "image_url");
            imagePart.putObject("image_url").put("url", imageUrl);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://api.openai.com/v1/chat/completions"))
                    .header("Content-Type",  "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .timeout(Duration.ofSeconds(60))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(requestBody)))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                System.err.printf("[OpenAI] Vision API error %d: %s%n", response.statusCode(), response.body());
                return null;
            }

            JsonNode responseNode = objectMapper.readTree(response.body());
            String text = responseNode.get("choices").get(0).get("message").get("content").asText().strip();

            int start = text.indexOf('{');
            int end   = text.lastIndexOf('}') + 1;
            if (start == -1 || end == 0) return null;

            return objectMapper.readTree(text.substring(start, end));

        } catch (Exception e) {
            System.err.printf("[OpenAI] Error OCR'ing image: %s%n", e.getMessage());
            return null;
        }
    }

    private String buildPrompt(String cafeName, String website, String content) {
        return """
                Analyze this cafe's website content. Determine if they serve matcha and how transparent they are about sourcing.

                Cafe: %s
                Website: %s

                Content:
                %s

                Respond with ONLY valid JSON — no explanation, no markdown:
                {
                  "servesMatcha": true,
                  "level": "A",
                  "evidenceQuote": "VERBATIM copy-paste from the Content above that proves the level, or null",
                  "tagline": "one short sentence describing their matcha offering, or null",
                  "description": "two sentences about their matcha program, or null",
                  "specialties": ["Matcha Latte", "Hojicha"],
                  "type": "cafe"
                }

                Level guide (assign based ONLY on evidence in the content):
                A = Names a specific JAPANESE growing region/prefecture (Uji, Nishio, Kagoshima,
                    Yame, Shizuoka, Wazuka, etc.), OR names a specific Japanese farm, tea garden
                    or estate that grew the leaf
                B = Establishes the matcha is Japanese but names no region, farm or garden
                    (e.g. "Japanese matcha", "imported from Japan", "harvested in Japan")
                C = Serves matcha but zero sourcing information disclosed
                D = Not enough information to classify (but does serve matcha)
                null = Does not serve matcha at all

                CRITICAL RULES for evidenceQuote:
                - It MUST be copied word-for-word from the Content above. Do NOT paraphrase, rewrite, or invent.
                - If you cannot find an exact verbatim passage in the Content supporting level A or B, set evidenceQuote to null and use level C instead.
                - Never fabricate or summarize text for evidenceQuote.
                - Choose the STRONGEST passage available: prefer one naming a Japanese region or
                  farm over one that merely says "Japanese".

                A RESELLER OR BRAND NAME IS NOT ORIGIN EVIDENCE:
                - Naming the wholesaler, brand or distributor the cafe buys from (e.g. "Matcha
                  Maiden", "Somage", "The Tea Collective", "Zen Wonders", "Matcha Society") says
                  nothing about where the leaf was grown. That is level C unless the same content
                  ALSO states a Japanese region, farm, or that the matcha is Japanese.
                - Grade words alone ("ceremonial grade", "premium", "first harvest", "single
                  origin" with no origin named) are marketing, not sourcing disclosure. Level C.

                Type options: "specialty", "cafe", "dessert", "chain"
                """.formatted(cafeName, website, content);
    }

    private CafeAnalysis parseAnalysis(String text) throws Exception {
        int start = text.indexOf('{');
        int end   = text.lastIndexOf('}') + 1;
        if (start == -1 || end == 0) return null;

        JsonNode result = objectMapper.readTree(text.substring(start, end));

        boolean servesMatcha = result.has("servesMatcha") && result.get("servesMatcha").asBoolean();
        String level         = getStringOrNull(result, "level");
        String evidenceQuote = getStringOrNull(result, "evidenceQuote");
        String tagline       = getStringOrNull(result, "tagline");
        String description   = getStringOrNull(result, "description");
        String type          = result.has("type") ? result.get("type").asText("cafe") : "cafe";

        List<String> specialties = new ArrayList<>();
        if (result.has("specialties") && result.get("specialties").isArray()) {
            for (JsonNode item : result.get("specialties")) {
                specialties.add(item.asText());
            }
        }

        return new CafeAnalysis(servesMatcha, level, evidenceQuote, tagline, description, specialties, type);
    }

    private String getStringOrNull(JsonNode node, String field) {
        if (!node.has(field) || node.get(field).isNull()) return null;
        String val = node.get(field).asText().strip();
        return val.isEmpty() || val.equals("null") ? null : val;
    }
}
