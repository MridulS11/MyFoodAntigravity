"use client";

import { Crosshair, MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GeoPoint } from "@/services/contracts/types";

export interface ResolvedAddressFields {
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

interface GoogleMapPickerProps {
  value: GeoPoint;
  onChange: (point: GeoPoint) => void;
  onAddressResolved?: (fields: ResolvedAddressFields) => void;
  heightClassName?: string;
  label?: string;
  helperText?: string;
  mapStyle?: "minimal" | "default";
}

// Strict minimal map style for customer-facing location selection:
// keeps roads, street names, major landmarks, hospitals, schools/colleges, parks,
// and selective transit (rail/airport) visible while hiding business/shopping/minor POIs.
const MINIMAL_CUSTOMER_MAP_STYLES = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi.medical", stylers: [{ visibility: "on" }] },
  { featureType: "poi.school", stylers: [{ visibility: "on" }] },
  { featureType: "poi.park", stylers: [{ visibility: "on" }] },
  { featureType: "poi.attraction", stylers: [{ visibility: "on" }] },
  { featureType: "poi.government", stylers: [{ visibility: "on" }] },
  { featureType: "poi.place_of_worship", stylers: [{ visibility: "on" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station.rail", stylers: [{ visibility: "on" }] },
  { featureType: "transit.station.airport", stylers: [{ visibility: "on" }] },
  { featureType: "road.highway", stylers: [{ visibility: "on" }] },
  { featureType: "road.arterial", stylers: [{ visibility: "on" }] },
  { featureType: "road.local", stylers: [{ visibility: "on" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "on" }] },
];

interface PlacePrediction {
  placeId: string;
  description: string;
}

interface NewPlaceAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GoogleMapsNamespace {
  maps?: {
    Map: new (
      el: HTMLElement,
      opts: Record<string, unknown>
    ) => {
      setCenter: (pos: GeoPoint) => void;
      panTo: (pos: GeoPoint) => void;
      addListener: (
        event: string,
        cb: (e: { latLng?: { lat: () => number; lng: () => number } }) => void
      ) => { remove: () => void };
    };
    Marker: new (opts: Record<string, unknown>) => {
      setPosition: (pos: GeoPoint) => void;
      addListener: (
        event: string,
        cb: (e: { latLng?: { lat: () => number; lng: () => number } }) => void
      ) => { remove: () => void };
      setMap: (map: unknown) => void;
    };
    Point: new (x: number, y: number) => unknown;
    Geocoder: new () => {
      geocode: (
        req: Record<string, unknown>,
        cb: (
          results: Array<{
            formatted_address?: string;
            types?: string[];
            geometry?: { location?: { lat: () => number; lng: () => number } };
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
          }> | null,
          status: string
        ) => void
      ) => void;
    };
  };
}

const MIN_SEARCH_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 350;
const COUNTRY_CODE = "in";
const LOCATION_BIAS_RADIUS_METERS = 25000;
const PLACE_DETAIL_FIELD_MASK = "location,formattedAddress,addressComponents";

// Reuse previously resolved places/queries in-memory to avoid duplicate Places API calls.
const predictionCache = new Map<string, PlacePrediction[]>();
const placeDetailsCache = new Map<
  string,
  { point: GeoPoint; fields: ResolvedAddressFields }
>();

let googleMapsLoaderPromise: Promise<GoogleMapsNamespace> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<GoogleMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window unavailable"));
  }
  const win = window as unknown as { google?: GoogleMapsNamespace };
  if (win.google?.maps) {
    return Promise.resolve(win.google);
  }
  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  googleMapsLoaderPromise = new Promise<GoogleMapsNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-goodly-gmaps="true"]'
    );
    if (existing) {
      existing.addEventListener("load", () => {
        if (win.google?.maps) resolve(win.google);
        else reject(new Error("Google Maps failed to initialize"));
      });
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Google Maps script"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}`;
    script.async = true;
    script.defer = true;
    script.dataset.goodlyGmaps = "true";
    script.onload = () => {
      if (win.google?.maps) {
        resolve(win.google);
      } else {
        reject(new Error("Google Maps SDK unavailable after load"));
      }
    };
    script.onerror = () => reject(new Error("Could not load Google Maps"));
    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

function parseAddressComponents(
  components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }> = [],
  formattedAddress?: string
): ResolvedAddressFields {
  const byType = (type: string) =>
    components.find((c) => c.types.includes(type));

  const streetNumber = byType("street_number")?.long_name;
  const route = byType("route")?.long_name;
  const sublocality =
    byType("sublocality_level_1")?.long_name ||
    byType("sublocality")?.long_name ||
    byType("neighborhood")?.long_name;
  const city =
    byType("locality")?.long_name ||
    byType("administrative_area_level_2")?.long_name;
  const state = byType("administrative_area_level_1")?.short_name;
  const postalCode = byType("postal_code")?.long_name;

  const streetParts = [streetNumber, route, sublocality].filter(Boolean);
  const addressLine1 =
    streetParts.length > 0
      ? streetParts.join(", ")
      : formattedAddress?.split(",").slice(0, 2).join(",").trim();

  return {
    ...(addressLine1 ? { addressLine1 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postalCode ? { postalCode } : {}),
  };
}

function parseNewPlaceAddressComponents(
  components: NewPlaceAddressComponent[] = [],
  formattedAddress?: string
): ResolvedAddressFields {
  return parseAddressComponents(
    components.map((c) => ({
      long_name: c.longText ?? "",
      short_name: c.shortText ?? "",
      types: c.types ?? [],
    })),
    formattedAddress
  );
}

export function GoogleMapPicker({
  value,
  onChange,
  onAddressResolved,
  heightClassName = "h-[220px]",
  label = "Pin exact location on map",
  helperText = "Click anywhere on the map or drag the marker to set exact coordinates.",
  mapStyle = "default",
}: GoogleMapPickerProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<
    NonNullable<GoogleMapsNamespace["maps"]>["Map"]
  > | null>(null);
  const markerRef = useRef<InstanceType<
    NonNullable<GoogleMapsNamespace["maps"]>["Marker"]
  > | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onAddressResolvedRef = useRef(onAddressResolved);

  useEffect(() => {
    onChangeRef.current = onChange;
    onAddressResolvedRef.current = onAddressResolved;
  }, [onChange, onAddressResolved]);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(
    apiKey ? null : "Google Maps API key is not configured."
  );
  const [searchText, setSearchText] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [locating, setLocating] = useState(false);

  function reverseGeocode(point: GeoPoint) {
    const win = window as unknown as { google?: GoogleMapsNamespace };
    const Geocoder = win.google?.maps?.Geocoder;
    if (!Geocoder || !onAddressResolvedRef.current) return;

    try {
      const geocoder = new Geocoder();
      geocoder.geocode({ location: point }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const parsed = parseAddressComponents(
            results[0].address_components,
            results[0].formatted_address
          );
          onAddressResolvedRef.current?.(parsed);
        }
      });
    } catch {
      // Geocoding API is optional; ignore if restricted or unavailable.
    }
  }

  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;
    let clickListener: { remove: () => void } | null = null;
    let dragListener: { remove: () => void } | null = null;

    loadGoogleMapsScript(apiKey)
      .then((g) => {
        if (cancelled || !containerRef.current || !g.maps) return;

        const map = new g.maps.Map(containerRef.current, {
          center: value,
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: mapStyle !== "minimal",
          styles: mapStyle === "minimal" ? MINIMAL_CUSTOMER_MAP_STYLES : undefined,
        });

        // Native vector Symbol renders reliably in all browsers without SVG data-URL decoding issues.
        const customPinSymbol = {
          path: "M12 2C7.589 2 4 5.589 4 10c0 6.5 8 14 8 14s8-7.5 8-14c0-4.411-3.589-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z",
          fillColor: "#5F8E63",
          fillOpacity: 1,
          strokeColor: "#1E1F1C",
          strokeWeight: 1.8,
          scale: 1.7,
          anchor: g.maps.Point ? new g.maps.Point(12, 24) : undefined,
        };

        const marker = new g.maps.Marker({
          position: value,
          map,
          draggable: true,
          title: "Selected location",
          icon: customPinSymbol,
        });

        clickListener = map.addListener("click", (e) => {
          if (!e.latLng) return;
          const next = {
            lat: Number(e.latLng.lat().toFixed(6)),
            lng: Number(e.latLng.lng().toFixed(6)),
          };
          setPredictions([]);
          marker.setPosition(next);
          map.panTo(next);
          onChangeRef.current(next);
          reverseGeocode(next);
        });

        dragListener = marker.addListener("dragend", (e) => {
          if (!e.latLng) return;
          const next = {
            lat: Number(e.latLng.lat().toFixed(6)),
            lng: Number(e.latLng.lng().toFixed(6)),
          };
          setPredictions([]);
          map.panTo(next);
          onChangeRef.current(next);
          reverseGeocode(next);
        });

        mapRef.current = map;
        markerRef.current = marker;
        setMapReady(true);
        setMapError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setMapError(
            err instanceof Error ? err.message : "Could not load Google Maps."
          );
        }
      });

    return () => {
      cancelled = true;
      clickListener?.remove();
      dragListener?.remove();
      markerRef.current?.setMap(null);
      mapRef.current = null;
      markerRef.current = null;
    };
    // Initialize map once per key mount; subsequent value changes pan the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    if (mapRef.current && markerRef.current) {
      markerRef.current.setPosition(value);
      mapRef.current.panTo(value);
    }
  }, [value]);

  // Debounced Places API (New) Autocomplete:
  // min 3 chars, 350ms debounce, IN restriction, location bias, session token, and cache.
  useEffect(() => {
    if (!mapReady || !apiKey) return;
    const trimmed = searchText.trim();
    if (trimmed.length < MIN_SEARCH_CHARS) {
      return;
    }

    const cacheKey = `${trimmed.toLowerCase()}@${value.lat.toFixed(
      2
    )},${value.lng.toFixed(2)}`;
    const cached = predictionCache.get(cacheKey);
    if (cached) {
      const timer = window.setTimeout(() => setPredictions(cached), 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!sessionTokenRef.current) {
        sessionTokenRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }

      try {
        const res = await fetch(
          "https://places.googleapis.com/v1/places:autocomplete",
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
            },
            body: JSON.stringify({
              input: trimmed,
              includedRegionCodes: [COUNTRY_CODE],
              locationBias: {
                circle: {
                  center: {
                    latitude: value.lat,
                    longitude: value.lng,
                  },
                  radius: LOCATION_BIAS_RADIUS_METERS,
                },
              },
              sessionToken: sessionTokenRef.current,
            }),
          }
        );

        if (res.ok) {
          const data = (await res.json()) as {
            suggestions?: Array<{
              placePrediction?: {
                placeId?: string;
                text?: { text?: string };
              };
            }>;
          };
          const mapped: PlacePrediction[] = (data.suggestions ?? [])
            .map((s) => ({
              placeId: s.placePrediction?.placeId ?? "",
              description: s.placePrediction?.text?.text ?? "",
            }))
            .filter((p) => p.placeId && p.description);

          if (mapped.length > 0) {
            predictionCache.set(cacheKey, mapped);
            setPredictions(mapped);
            return;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      }

      // Fallback to Geocoder if Places API (New) returns no suggestions;
      // filter out overly broad country-only matches like "India".
      const win = window as unknown as { google?: GoogleMapsNamespace };
      const Geocoder = win.google?.maps?.Geocoder;
      if (!Geocoder) {
        setPredictions([]);
        return;
      }
      try {
        const geocoder = new Geocoder();
        geocoder.geocode(
          {
            address: trimmed,
            componentRestrictions: { country: "IN" },
          },
          (results, status) => {
            if (status === "OK" && results && results.length > 0) {
              const specific = results.filter(
                (r) => !(r.types?.length === 1 && r.types[0] === "country")
              );
              const mapped: PlacePrediction[] = specific
                .slice(0, 5)
                .map((r, idx) => {
                  const id = `geo:${idx}:${r.formatted_address ?? trimmed}`;
                  const loc = r.geometry?.location;
                  if (loc) {
                    placeDetailsCache.set(id, {
                      point: {
                        lat: Number(loc.lat().toFixed(6)),
                        lng: Number(loc.lng().toFixed(6)),
                      },
                      fields: parseAddressComponents(
                        r.address_components,
                        r.formatted_address
                      ),
                    });
                  }
                  return {
                    placeId: id,
                    description: r.formatted_address ?? trimmed,
                  };
                });
              predictionCache.set(cacheKey, mapped);
              setPredictions(mapped);
            } else {
              setPredictions([]);
            }
          }
        );
      } catch {
        setPredictions([]);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiKey, mapReady, searchText, value.lat, value.lng]);

  async function handleSelectPrediction(pred: PlacePrediction) {
    setPredictions([]);
    setSearchText(pred.description);

    // Reuse cached details if this place was already selected in this session.
    const cached = placeDetailsCache.get(pred.placeId);
    if (cached) {
      onChange(cached.point);
      onAddressResolved?.(cached.fields);
      sessionTokenRef.current = null;
      return;
    }

    if (!apiKey) return;
    const token = sessionTokenRef.current;
    // Always end the billing session after place selection.
    sessionTokenRef.current = null;

    try {
      const qs = token ? `?sessionToken=${encodeURIComponent(token)}` : "";
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(
          pred.placeId
        )}${qs}`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": PLACE_DETAIL_FIELD_MASK,
          },
        }
      );
      if (!res.ok) return;
      const place = (await res.json()) as {
        location?: { latitude?: number; longitude?: number };
        formattedAddress?: string;
        addressComponents?: NewPlaceAddressComponent[];
      };
      if (
        typeof place.location?.latitude === "number" &&
        typeof place.location?.longitude === "number"
      ) {
        const next = {
          lat: Number(place.location.latitude.toFixed(6)),
          lng: Number(place.location.longitude.toFixed(6)),
        };
        const fields = parseNewPlaceAddressComponents(
          place.addressComponents,
          place.formattedAddress
        );
        placeDetailsCache.set(pred.placeId, { point: next, fields });
        onChange(next);
        onAddressResolved?.(fields);
      }
    } catch {
      // Ignore network errors on place details fetch.
    }
  }

  function handleUseCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMapError("Browser geolocation is unavailable.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        onChange(next);
        reverseGeocode(next);
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function handleAddressSearch() {
    const query = searchText.trim();
    if (query.length < MIN_SEARCH_CHARS) return;
    if (predictions.length > 0) {
      void handleSelectPrediction(predictions[0]);
      return;
    }
    const win = window as unknown as { google?: GoogleMapsNamespace };
    const Geocoder = win.google?.maps?.Geocoder;
    if (!Geocoder) return;
    try {
      const geocoder = new Geocoder();
      geocoder.geocode(
        {
          address: query,
          componentRestrictions: { country: "IN" },
        },
        (results, status) => {
          if (status === "OK" && results) {
            const best = results.find(
              (r) => !(r.types?.length === 1 && r.types[0] === "country")
            );
            if (best?.geometry?.location) {
              const loc = best.geometry.location;
              const next = {
                lat: Number(loc.lat().toFixed(6)),
                lng: Number(loc.lng().toFixed(6)),
              };
              onChange(next);
              onAddressResolved?.(
                parseAddressComponents(
                  best.address_components,
                  best.formatted_address
                )
              );
            }
          }
        }
      );
    } catch {
      // Ignore if Geocoding API is disabled on the key.
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-[#E8E3D5] bg-[#FCF9F0] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E1F1C]">
          <MapPin className="w-3.5 h-3.5 text-[#5F8E63]" />
          <span>{label}</span>
        </div>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={locating}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#E8E3D5] bg-white hover:bg-[#F5F0E2] text-[11px] font-semibold text-[#1E1F1C] disabled:opacity-50"
        >
          <Crosshair className="w-3 h-3 text-[#5F8E63]" />
          <span>{locating ? "Locating..." : "Use current location"}</span>
        </button>
      </div>

      {mapReady && (
        <div className="relative z-30">
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#8A8880] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddressSearch();
                  }
                }}
                placeholder="Type 3+ chars to search area, street, or landmark..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#E8E3D5] bg-white text-xs text-[#1E1F1C] transition-shadow focus:outline-none focus:ring-2 focus:ring-[#5F8E63]/30"
              />
            </div>
            <button
              type="button"
              onClick={handleAddressSearch}
              disabled={searchText.trim().length < MIN_SEARCH_CHARS}
              className="px-3 py-1.5 rounded-lg bg-[#1E1F1C] text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              Find
            </button>
          </div>
          {searchText.trim().length >= MIN_SEARCH_CHARS &&
            predictions.length > 0 && (
              <ul
                role="listbox"
                className="absolute left-0 right-0 top-full z-50 mt-1.5 bg-white/98 backdrop-blur-sm border border-[#E8E3D5] rounded-xl shadow-xl max-h-44 overflow-y-auto divide-y divide-[#F3EFE3] transition-all duration-200 ease-out origin-top animate-in fade-in slide-in-from-top-1"
              >
                {predictions.map((pred) => (
                  <li key={pred.placeId}>
                    <button
                      type="button"
                      onClick={() => void handleSelectPrediction(pred)}
                      className="w-full text-left px-3 py-2.5 hover:bg-[#FCF9F0] text-xs text-[#1E1F1C] flex items-start gap-2 transition-colors duration-150"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#5F8E63] mt-0.5 shrink-0" />
                      <span>{pred.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {mapError ? (
        <div className="rounded-lg border border-dashed border-[#D5CEBC] bg-white p-3 space-y-2">
          <p className="text-[11px] text-[#8A8880]">{mapError}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-semibold text-[#5E5D57]">
              Latitude
              <input
                type="number"
                step="0.000001"
                value={value.lat}
                onChange={(e) =>
                  onChange({
                    ...value,
                    lat: Number(e.target.value) || 0,
                  })
                }
                className="mt-1 w-full px-2 py-1 rounded border border-[#E8E3D5] text-xs"
              />
            </label>
            <label className="text-[11px] font-semibold text-[#5E5D57]">
              Longitude
              <input
                type="number"
                step="0.000001"
                value={value.lng}
                onChange={(e) =>
                  onChange({
                    ...value,
                    lng: Number(e.target.value) || 0,
                  })
                }
                className="mt-1 w-full px-2 py-1 rounded border border-[#E8E3D5] text-xs"
              />
            </label>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          data-testid="google-map-picker"
          className={`w-full ${heightClassName} rounded-lg overflow-hidden border border-[#E8E3D5] bg-[#EDE9DD]`}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5E5D57]">
        <span>{helperText}</span>
        <span className="font-mono text-[10px] text-[#8A8880]">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </span>
      </div>
    </div>
  );
}
