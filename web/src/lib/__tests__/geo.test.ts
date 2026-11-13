import { describe, expect, it } from "vitest";
import { formatDistance, haversineDistanceMeters } from "../geo";

describe("geo utilities", () => {
  it("computes Haversine distance accurately between two coordinates", () => {
    const indiranagar = { lat: 12.9784, lng: 77.6408 };
    const koramangala = { lat: 12.9352, lng: 77.6245 };

    expect(haversineDistanceMeters(indiranagar, indiranagar)).toBe(0);

    const meters = haversineDistanceMeters(indiranagar, koramangala);
    // ~5.1 km between Indiranagar 100ft Rd and Koramangala
    expect(meters).toBeGreaterThan(4800);
    expect(meters).toBeLessThan(5400);
  });

  it("formats meters and kilometers cleanly", () => {
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(-10)).toBeNull();
    expect(formatDistance(450)).toBe("450 m");
    expect(formatDistance(999)).toBe("999 m");
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(2450)).toBe("2.5 km");
  });
});
