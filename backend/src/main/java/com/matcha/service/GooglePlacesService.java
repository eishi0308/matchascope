package com.matcha.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Discovers matcha cafes in a city using the Google Places API (New — v1).
 *
 * Requires a Google Cloud API key with "Places API (New)" enabled.
 * Set via: GOOGLE_PLACES_API_KEY environment variable
 *          or google.places.api.key in application.properties
 */
@Service
public class GooglePlacesService {

    @Value("${google.places.api.key:}")
    private String apiKey;

    private static final String SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
    private static final String FIELD_MASK  =
            "places.id,places.displayName,places.formattedAddress," +
            "places.location,places.websiteUri,places.types,places.rating,places.photos.name";
    private static final String PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/%s/media";

    private final HttpClient    httpClient    = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();
    private final ObjectMapper  objectMapper  = new ObjectMapper();

    public record PlaceInfo(
            String googleId,
            String name,
            String website,
            String instagram,   // null — Google Places does not return Instagram
            Double lat,
            Double lng,
            String suburb,
            String address,
            List<String> photoNames  // resource names, e.g. "places/{id}/photos/{ref}" — never null, may be empty
    ) {}

    // Key suburbs to search per city for maximum coverage
    private static final Map<String, List<SuburbCoord>> CITY_SUBURBS = Map.of(
        "Sydney", List.of(
            new SuburbCoord("Sydney CBD",        -33.8688, 151.2093),
            new SuburbCoord("Newtown",            -33.8979, 151.1783),
            new SuburbCoord("Surry Hills",        -33.8853, 151.2115),
            new SuburbCoord("Haymarket",          -33.8783, 151.2017),
            new SuburbCoord("Chippendale",        -33.8855, 151.1996),
            new SuburbCoord("Chatswood",          -33.7969, 151.1824),
            new SuburbCoord("Bondi Junction",     -33.8914, 151.2490),
            new SuburbCoord("Darlinghurst",       -33.8762, 151.2199),
            new SuburbCoord("Redfern",            -33.8930, 151.2034),
            new SuburbCoord("Glebe",              -33.8797, 151.1869),
            new SuburbCoord("Parramatta",         -33.8150, 151.0011),
            new SuburbCoord("Burwood",            -33.8775, 151.1036),
            new SuburbCoord("Hurstville",         -33.9667, 151.1000),
            new SuburbCoord("Strathfield",        -33.8750, 151.0833),
            new SuburbCoord("Marrickville",       -33.9108, 151.1555),
            new SuburbCoord("Eastwood",           -33.7900, 151.0817),
            new SuburbCoord("North Sydney",       -33.8388, 151.2069),
            new SuburbCoord("Manly",              -33.7969, 151.2874),
            new SuburbCoord("Ultimo",             -33.8808, 151.1977),
            new SuburbCoord("Waterloo",           -33.9003, 151.2073),
            new SuburbCoord("Rhodes",             -33.8283, 151.0875),
            new SuburbCoord("Cabramatta",         -33.8950, 150.9376)
        ),
        "Melbourne", List.of(
            new SuburbCoord("Melbourne CBD",      -37.8136, 144.9631),
            new SuburbCoord("Fitzroy",            -37.7964, 144.9784),
            new SuburbCoord("Collingwood",        -37.8036, 144.9860),
            new SuburbCoord("Richmond",           -37.8183, 144.9986),
            new SuburbCoord("South Yarra",        -37.8386, 144.9919),
            new SuburbCoord("Brunswick",          -37.7699, 144.9600),
            new SuburbCoord("Carlton",            -37.7988, 144.9657),
            new SuburbCoord("St Kilda",           -37.8676, 144.9820),
            new SuburbCoord("Hawthorn",           -37.8224, 145.0282),
            new SuburbCoord("Prahran",            -37.8497, 144.9919),
            new SuburbCoord("Footscray",          -37.8003, 144.8997),
            new SuburbCoord("Box Hill",           -37.8196, 145.1239),
            new SuburbCoord("Docklands",          -37.8148, 144.9468),
            new SuburbCoord("Southbank",          -37.8230, 144.9631),
            new SuburbCoord("Glen Waverley",      -37.8785, 145.1635),
            new SuburbCoord("Northcote",          -37.7699, 145.0087),
            new SuburbCoord("Clayton",            -37.9191, 145.1238),
            new SuburbCoord("Camberwell",         -37.8333, 145.0667),
            new SuburbCoord("Springvale",         -37.9502, 145.1499),
            new SuburbCoord("Preston",            -37.7444, 145.0131),
            new SuburbCoord("Moonee Ponds",       -37.7669, 144.9201),
            new SuburbCoord("Elwood",             -37.8833, 144.9833)
        )
    );

    private record SuburbCoord(String name, double lat, double lng) {}

    // City-wide query terms
    private static final String[] CITY_QUERIES = {
        "matcha cafe",
        "matcha latte",
        "japanese matcha",
        "matcha bar",
        "matcha dessert",
        "matcha soft serve",
        "hojicha cafe",
        "japanese tea house",
        "ceremonial matcha",
        "matcha ice cream",
        "japanese cafe",
        "tea bar",
        "wagashi",
        "japanese dessert cafe",
        "korean cafe matcha",
    };

    // Suburb-level terms (shorter, more targeted)
    private static final String[] SUBURB_QUERIES = {
        "matcha cafe",
        "matcha latte",
        "japanese cafe",
        "hojicha",
        "matcha dessert",
    };

    /**
     * Search for matcha cafes using city-wide queries + suburb-level searches for full coverage.
     */
    public List<PlaceInfo> searchMatchaCafes(String cityName, double lat, double lng) throws Exception {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                "Google Places API key not configured. " +
                "Set GOOGLE_PLACES_API_KEY as an environment variable " +
                "or google.places.api.key in application.properties."
            );
        }

        Set<String>     seenIds = new HashSet<>();
        List<PlaceInfo> results = new ArrayList<>();

        // 1. City-wide searches
        for (String term : CITY_QUERIES) {
            String query = term + " " + cityName + " Australia";
            System.out.printf("[GooglePlaces] Searching: \"%s\"%n", query);
            for (PlaceInfo p : searchWithQuery(query, lat, lng)) {
                if (seenIds.add(p.googleId())) results.add(p);
            }
            Thread.sleep(500);
        }

        // 2. Suburb-level searches for maximum coverage
        List<SuburbCoord> suburbs = CITY_SUBURBS.getOrDefault(cityName, List.of());
        for (SuburbCoord suburb : suburbs) {
            for (String term : SUBURB_QUERIES) {
                String query = term + " " + suburb.name() + " Australia";
                System.out.printf("[GooglePlaces] Searching suburb: \"%s\"%n", query);
                for (PlaceInfo p : searchWithQuery(query, suburb.lat(), suburb.lng())) {
                    if (seenIds.add(p.googleId())) results.add(p);
                }
                Thread.sleep(400);
            }
        }

        System.out.printf("[GooglePlaces] Total unique places found in %s: %d%n", cityName, results.size());
        return results;
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private List<PlaceInfo> searchWithQuery(String query, double lat, double lng) throws Exception {
        List<PlaceInfo> results   = new ArrayList<>();
        String          pageToken = null;
        int             maxPages  = 5; // up to 100 results (20 per page)

        for (int page = 0; page < maxPages; page++) {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("textQuery", query);
            body.put("maxResultCount", 20);
            body.put("languageCode", "en");

            // Bias results towards the city centre
            ObjectNode locationBias = body.putObject("locationBias");
            ObjectNode circle       = locationBias.putObject("circle");
            ObjectNode center       = circle.putObject("center");
            center.put("latitude",  lat);
            center.put("longitude", lng);
            circle.put("radius", 35000.0); // 35 km

            if (pageToken != null) {
                body.put("pageToken", pageToken);
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(SEARCH_URL))
                    .header("Content-Type",   "application/json")
                    .header("X-Goog-Api-Key", apiKey)
                    .header("X-Goog-FieldMask", FIELD_MASK)
                    .timeout(Duration.ofSeconds(30))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                System.err.printf("[GooglePlaces] Error %d: %s%n", response.statusCode(), response.body());
                break;
            }

            JsonNode root   = objectMapper.readTree(response.body());
            JsonNode places = root.get("places");

            if (places == null || !places.isArray() || places.isEmpty()) break;

            for (JsonNode place : places) {
                PlaceInfo info = parsePlaceInfo(place);
                if (info != null) results.add(info);
            }

            pageToken = root.has("nextPageToken") ? root.get("nextPageToken").asText() : null;
            if (pageToken == null) break;

            Thread.sleep(2000); // Google requires a delay between paginated requests
        }

        return results;
    }

    private PlaceInfo parsePlaceInfo(JsonNode place) {
        try {
            String id      = place.get("id").asText();
            String name    = place.get("displayName").get("text").asText();
            double lat     = place.get("location").get("latitude").asDouble();
            double lng     = place.get("location").get("longitude").asDouble();
            String address = place.has("formattedAddress") ? place.get("formattedAddress").asText() : "";
            String website = place.has("websiteUri")       ? place.get("websiteUri").asText()       : null;
            String suburb  = extractSuburb(address);

            List<String> photoNames = new ArrayList<>();
            if (place.has("photos") && place.get("photos").isArray()) {
                for (JsonNode photo : place.get("photos")) {
                    if (photo.has("name")) photoNames.add(photo.get("name").asText());
                }
            }

            return new PlaceInfo(id, name, website, null, lat, lng, suburb, address, photoNames);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Recover a single place's id and photos by name/location — for cafes stored before
     * {@code googleId} was captured on discovery. Issues exactly one Text Search request (no
     * pagination, no suburb fan-out) at Google's standard price; unlike {@link #fetchPhotoUri}
     * this is not covered by {@link ApiBudgetGuard}'s free-tier ceiling.
     *
     * @return the best-matching place, or null if the lookup found or fetched nothing
     */
    public PlaceInfo findPlaceByNameAndAddress(String name, String address, Double lat, Double lng) {
        if (apiKey == null || apiKey.isBlank()) return null;
        try {
            String query = (address != null && !address.isBlank()) ? name + ", " + address : name;

            ObjectNode body = objectMapper.createObjectNode();
            body.put("textQuery", query);
            body.put("maxResultCount", 1);
            body.put("languageCode", "en");
            if (lat != null && lng != null) {
                ObjectNode locationBias = body.putObject("locationBias");
                ObjectNode circle       = locationBias.putObject("circle");
                ObjectNode center       = circle.putObject("center");
                center.put("latitude",  lat);
                center.put("longitude", lng);
                circle.put("radius", 2000.0); // tight — this cafe is already known, not being discovered
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(SEARCH_URL))
                    .header("Content-Type",   "application/json")
                    .header("X-Goog-Api-Key", apiKey)
                    .header("X-Goog-FieldMask", FIELD_MASK)
                    .timeout(Duration.ofSeconds(30))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                System.err.printf("[GooglePlaces] Lookup error %d for \"%s\": %s%n", response.statusCode(), query, response.body());
                return null;
            }

            JsonNode root   = objectMapper.readTree(response.body());
            JsonNode places = root.get("places");
            if (places == null || !places.isArray() || places.isEmpty()) return null;

            return parsePlaceInfo(places.get(0));
        } catch (Exception e) {
            System.err.printf("[GooglePlaces] Lookup failed for \"%s\": %s%n", name, e.getMessage());
            return null;
        }
    }

    /**
     * Resolve one photo resource name (from {@link PlaceInfo#photoNames()}) to a short-lived
     * CDN image URL. Billed as a single "Place Photos" request — call {@code
     * ApiBudgetGuard.tryConsumePlacesPhotoRequest()} before this, not after.
     *
     * <p>{@code skipHttpRedirect=true} asks for JSON ({@code {"photoUri": "..."}}) instead of
     * a 302 straight to the image, so the returned URL can be handed to a caller (e.g. OpenAI's
     * {@code image_url}) without this service downloading the image bytes itself.
     *
     * @return the CDN {@code photoUri}, or null on any failure
     */
    public String fetchPhotoUri(String photoResourceName, int maxWidthPx) {
        if (apiKey == null || apiKey.isBlank()) return null;
        try {
            String url = String.format(PHOTO_MEDIA_URL, photoResourceName)
                    + "?skipHttpRedirect=true&maxWidthPx=" + maxWidthPx
                    + "&key=" + apiKey;

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                System.err.printf("[GooglePlaces] Photo media error %d for %s: %s%n",
                        response.statusCode(), photoResourceName, response.body());
                return null;
            }

            JsonNode root = objectMapper.readTree(response.body());
            return root.has("photoUri") ? root.get("photoUri").asText() : null;
        } catch (Exception e) {
            System.err.printf("[GooglePlaces] Photo media fetch failed for %s: %s%n", photoResourceName, e.getMessage());
            return null;
        }
    }

    /**
     * Australian addresses look like: "123 King St, Newtown NSW 2042, Australia"
     * Extract the suburb (second comma-segment, before state/postcode).
     */
    private String extractSuburb(String address) {
        if (address == null || address.isBlank()) return "";
        String[] parts = address.split(",");
        if (parts.length >= 2) {
            return parts[1].trim()
                    .replaceAll("\\s+[A-Z]{2,3}\\s+\\d{4}.*", "") // remove "NSW 2042"
                    .trim();
        }
        return "";
    }
}
