// Nearest-named-place geocoder for the demo.
import type { ReverseGeocodeResult } from "../../electron/types";

const PLACES: Array<{ lat: number; lon: number; city: string; country: string; countryCode: string }> = [
  { lat: 21.03, lon: 105.85, city: "Hà Nội", country: "Vietnam", countryCode: "VN" },
  { lat: 21.08, lon: 105.37, city: "Ba Vì", country: "Vietnam", countryCode: "VN" },
  { lat: 21.17, lon: 105.6, city: "Sơn Tây", country: "Vietnam", countryCode: "VN" },
  { lat: 21.46, lon: 105.64, city: "Tam Đảo", country: "Vietnam", countryCode: "VN" },
  { lat: 21.26, lon: 105.83, city: "Sóc Sơn", country: "Vietnam", countryCode: "VN" },
  { lat: 20.25, lon: 105.97, city: "Ninh Bình", country: "Vietnam", countryCode: "VN" },
  { lat: 20.95, lon: 107.08, city: "Hạ Long", country: "Vietnam", countryCode: "VN" },
  { lat: 22.34, lon: 103.84, city: "Sa Pa", country: "Vietnam", countryCode: "VN" },
  { lat: 22.62, lon: 103.62, city: "Bát Xát", country: "Vietnam", countryCode: "VN" },
  { lat: 20.88, lon: 104.65, city: "Mộc Châu", country: "Vietnam", countryCode: "VN" },
  { lat: 16.05, lon: 108.2, city: "Đà Nẵng", country: "Vietnam", countryCode: "VN" },
  { lat: 11.94, lon: 108.44, city: "Đà Lạt", country: "Vietnam", countryCode: "VN" },
  { lat: 10.78, lon: 106.7, city: "Hồ Chí Minh City", country: "Vietnam", countryCode: "VN" },
  { lat: 18.79, lon: 98.98, city: "Chiang Mai", country: "Thailand", countryCode: "TH" },
  { lat: 13.73, lon: 100.54, city: "Bangkok", country: "Thailand", countryCode: "TH" }
];

export function reverseGeocode(lat: number, lon: number): ReverseGeocodeResult {
  let best = PLACES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const place of PLACES) {
    const d = (place.lat - lat) ** 2 + ((place.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = place;
    }
  }
  return { label: `${best.city}, ${best.country}`, lat, lon, city: best.city, country: best.country, countryCode: best.countryCode };
}
