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
    public void setEvidenceSource(String evidenceSource) { this.evidenceSource = evidenceSource; }

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
