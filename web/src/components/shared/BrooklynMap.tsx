"use client";

import type { GeoPoint } from "@/services/contracts/types";

interface BrooklynMapProps {
  pickup: GeoPoint;
  dropoff: GeoPoint;
  partnerLocation?: GeoPoint;
  restaurantName: string;
  customerLabel?: string;
  partnerName?: string;
  heightClass?: string;
}

function projectToSvg(pt: GeoPoint, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  const pad = 44;
  const w = 640 - pad * 2;
  const h = 340 - pad * 2;
  const latSpan = Math.max(0.015, bounds.maxLat - bounds.minLat);
  const lngSpan = Math.max(0.02, bounds.maxLng - bounds.minLng);
  const x = pad + ((pt.lng - bounds.minLng) / lngSpan) * w;
  const y = pad + (1 - (pt.lat - bounds.minLat) / latSpan) * h;
  return { x, y };
}

export function BrooklynMap({
  pickup,
  dropoff,
  partnerLocation,
  restaurantName,
  customerLabel = "Delivery address",
  partnerName,
  heightClass = "h-[340px]",
}: BrooklynMapProps) {
  const pts = [pickup, dropoff, ...(partnerLocation ? [partnerLocation] : [])];
  const minLat = Math.min(...pts.map((p) => p.lat)) - 0.004;
  const maxLat = Math.max(...pts.map((p) => p.lat)) + 0.004;
  const minLng = Math.min(...pts.map((p) => p.lng)) - 0.006;
  const maxLng = Math.max(...pts.map((p) => p.lng)) + 0.006;
  const bounds = { minLat, maxLat, minLng, maxLng };

  const p1 = projectToSvg(pickup, bounds);
  const p2 = projectToSvg(dropoff, bounds);
  const rider = partnerLocation ? projectToSvg(partnerLocation, bounds) : null;
  const midX = (p1.x + p2.x) / 2;
  const midY = Math.min(p1.y, p2.y) - 36;

  return (
    <div
      className={`relative w-full ${heightClass} rounded-2xl border border-[#E8E3D5] bg-[#F5F0E2] overflow-hidden`}
      role="img"
      aria-label={`Live Bengaluru delivery map between ${restaurantName} and ${customerLabel}`}
    >
      <svg
        viewBox="0 0 640 340"
        className="w-full h-full object-cover"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Warm neighborhood map grid */}
        <rect width="640" height="340" fill="#F5F0E2" />
        <g stroke="#E5DEC9" strokeWidth="1.5">
          {[50, 110, 170, 230, 290].map((y) => (
            <line key={`h-${y}`} x1="0" y1={y} x2="640" y2={y + 18} />
          ))}
          {[80, 180, 280, 380, 480, 580].map((x) => (
            <line key={`v-${x}`} x1={x} y1="0" x2={x - 24} y2="340" />
          ))}
        </g>

        {/* Prospect / neighborhood park accent */}
        <path
          d="M495,215 Q565,195 605,250 Q585,310 515,295 Z"
          fill="#CBEAD0"
          opacity="0.7"
        />
        <text
          x="542"
          y="258"
          fontSize="10"
          fill="#5F8E63"
          fontWeight="600"
          textAnchor="middle"
        >
          Indiranagar Park
        </text>

        {/* Route curve */}
        <path
          d={`M ${p1.x} ${p1.y} Q ${midX} ${midY} ${p2.x} ${p2.y}`}
          fill="none"
          stroke="#5F8E63"
          strokeWidth="3.5"
          strokeDasharray="7 5"
        />

        {/* Restaurant pin */}
        <g transform={`translate(${p1.x}, ${p1.y})`}>
          <circle r="13" fill="#DEC146" stroke="#1E1F1C" strokeWidth="2" />
          <text
            y="4"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#1E1F1C"
          >
            R
          </text>
          <rect
            x="-60"
            y="18"
            width="120"
            height="22"
            rx="6"
            fill="#FFFFFF"
            stroke="#E8E3D5"
          />
          <text
            y="33"
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="600"
            fill="#1E1F1C"
          >
            {restaurantName}
          </text>
        </g>

        {/* Customer pin */}
        <g transform={`translate(${p2.x}, ${p2.y})`}>
          <circle r="13" fill="#1E1F1C" stroke="#FFFFFF" strokeWidth="2.5" />
          <circle r="4" fill="#DEC146" />
          <rect
            x="-58"
            y="18"
            width="116"
            height="22"
            rx="6"
            fill="#FFFFFF"
            stroke="#E8E3D5"
          />
          <text
            y="33"
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="600"
            fill="#1E1F1C"
          >
            {customerLabel}
          </text>
        </g>

        {/* Delivery Partner Live Marker */}
        {rider && (
          <g transform={`translate(${rider.x}, ${rider.y})`}>
            <circle r="18" fill="#5F8E63" opacity="0.22" />
            <circle r="10" fill="#5F8E63" stroke="#FFFFFF" strokeWidth="2.5" />
            {partnerName && (
              <>
                <rect
                  x="-54"
                  y="-34"
                  width="108"
                  height="20"
                  rx="10"
                  fill="#1E1F1C"
                />
                <text
                  y="-21"
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill="#FCF9F0"
                >
                  {partnerName}
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      <div className="absolute top-3 left-3 bg-white/95 backdrop-blur border border-[#E8E3D5] rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#5E5D57]">
        Neighborhood Map · Google Maps adapter active in Phase 5
      </div>
    </div>
  );
}
