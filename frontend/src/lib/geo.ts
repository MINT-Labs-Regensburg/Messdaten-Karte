const EARTH_RADIUS_M = 6_371_008.8

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dphi = rad(lat2 - lat1)
  const dlmb = rad(lon2 - lon1)
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlmb / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function inCircle(
  point: { lat: number; lon: number },
  center: { lat: number; lon: number },
  radiusM: number,
): boolean {
  return haversineM(point.lat, point.lon, center.lat, center.lon) <= radiusM
}
