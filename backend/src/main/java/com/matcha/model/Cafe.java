package com.matcha.model;

import jakarta.persistence.*;

@Entity
@Table(name = "cafes")
public class Cafe {

    @Id
    private String id;
    private String name;

    // Google Places place id ("googleId" to avoid clashing with the entity's own @Id).
    // Not used for grading — captured so a future backfill pass (re-checking cafes
    // that predate photo verification) doesn't need to re-search Places to find them.
    private String googleId;

    private String city;
    private String suburb;
    private String address;
    private Double lat;
    private Double lng;

    @Enumerated(EnumType.STRING)
    private TransparencyLevel level;

    private String type;
    private String tagline;

    @Column(columnDefinition = "TEXT")
    private String description;

    // Evidence stored as flat columns
    @Column(columnDefinition = "TEXT")
    private String evidenceQuote;
    @Column(length = 1000)
    private String evidenceSource;
    private String evidenceSourceLabel;
    private String evidenceVerifiedDate;

    private String instagram;
    @Column(length = 1000)
    private String website;
    private String priceRange;

    // Stored as comma-separated string, converted to List in DTO
    private String specialties;

    private String coverColor;

    public Cafe() {}

    // Getters and setters

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getGoogleId() { return googleId; }
    public void setGoogleId(String googleId) { this.googleId = googleId; }

    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }

    public String getSuburb() { return suburb; }
    public void setSuburb(String suburb) { this.suburb = suburb; }

    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }

    public Double getLat() { return lat; }
    public void setLat(Double lat) { this.lat = lat; }

    public Double getLng() { return lng; }
    public void setLng(Double lng) { this.lng = lng; }

    public TransparencyLevel getLevel() { return level; }
    public void setLevel(TransparencyLevel level) { this.level = level; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getTagline() { return tagline; }
    public void setTagline(String tagline) { this.tagline = tagline; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getEvidenceQuote() { return evidenceQuote; }
    public void setEvidenceQuote(String evidenceQuote) { this.evidenceQuote = evidenceQuote; }

    public String getEvidenceSource() { return evidenceSource; }

    /**
     * Evidence sources are stored absolute, always.
     *
     * Callers pass through whatever the upstream listing held, and a good share of those
     * are bare hosts — OpenStreetMap website tags in particular are usually written
     * "www.example.com", and place.website() is the fallback when the exact quote page
     * cannot be located. A bare host is not a link in an href: the browser resolves it
     * against the app's own origin, so "View source" delivered the reader to our own 404
     * instead of the cafe's proof. Since the entire promise of a grade here is "go and
     * read the evidence yourself", normalising on write keeps that promise from being
     * broken by the shape of a field we do not control.
     */
    public void setEvidenceSource(String evidenceSource) { this.evidenceSource = absoluteUrl(evidenceSource); }

    /** "www.example.com" -> "https://www.example.com"; already-absolute URLs pass through. */
    private static String absoluteUrl(String url) {
        if (url == null) return null;
        String trimmed = url.strip();
        if (trimmed.isEmpty()) return null;
        if (trimmed.regionMatches(true, 0, "http://", 0, 7)
                || trimmed.regionMatches(true, 0, "https://", 0, 8)) return trimmed;
        if (trimmed.startsWith("//")) return "https:" + trimmed;
        return "https://" + trimmed.replaceFirst("^/+", "");
    }

    public String getEvidenceSourceLabel() { return evidenceSourceLabel; }
    public void setEvidenceSourceLabel(String evidenceSourceLabel) { this.evidenceSourceLabel = evidenceSourceLabel; }

    public String getEvidenceVerifiedDate() { return evidenceVerifiedDate; }
    public void setEvidenceVerifiedDate(String evidenceVerifiedDate) { this.evidenceVerifiedDate = evidenceVerifiedDate; }

    public String getInstagram() { return instagram; }
    public void setInstagram(String instagram) { this.instagram = instagram; }

    public String getWebsite() { return website; }
    public void setWebsite(String website) { this.website = website; }

    public String getPriceRange() { return priceRange; }
    public void setPriceRange(String priceRange) { this.priceRange = priceRange; }

    public String getSpecialties() { return specialties; }
    public void setSpecialties(String specialties) { this.specialties = specialties; }

    public String getCoverColor() { return coverColor; }
    public void setCoverColor(String coverColor) { this.coverColor = coverColor; }
}
