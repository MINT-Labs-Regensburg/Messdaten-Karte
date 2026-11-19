import math

EARTH_RADIUS_M = 6_371_008.8
M_PER_DEG = EARTH_RADIUS_M * math.pi / 180


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def to_local_xy(
    lat: float, lon: float, center_lat: float, center_lon: float
) -> tuple[float, float]:
    """Näherung (equirektangular) in Metern relativ zum Mittelpunkt; ausreichend bei ≤ 5 km."""
    x = (lon - center_lon) * M_PER_DEG * math.cos(math.radians(center_lat))
    y = (lat - center_lat) * M_PER_DEG
    return x, y


def from_local_xy(x: float, y: float, center_lat: float, center_lon: float) -> tuple[float, float]:
    lat = center_lat + y / M_PER_DEG
    lon = center_lon + x / (M_PER_DEG * math.cos(math.radians(center_lat)))
    return lat, lon


def circle_bounds(center_lat: float, center_lon: float, radius_m: float) -> dict[str, float]:
    north, east = from_local_xy(radius_m, radius_m, center_lat, center_lon)
    south, west = from_local_xy(-radius_m, -radius_m, center_lat, center_lon)
    return {"south": south, "west": west, "north": north, "east": east}


def in_circle(
    lat: float, lon: float, center_lat: float, center_lon: float, radius_m: float
) -> bool:
    return haversine_m(lat, lon, center_lat, center_lon) <= radius_m


# ---- Web-Mercator (Kartenkacheln, Bildexport)

MERC_R = 6_378_137.0
WORLD_M = 2 * math.pi * MERC_R  # Umfang der Mercator-Welt in Metern
EXTENT_PAD = 1.08  # Rand um den Kreis im Exportbild


def lonlat_to_mercator(lat: float, lon: float) -> tuple[float, float]:
    x = MERC_R * math.radians(lon)
    y = MERC_R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def mercator_scale(lat: float) -> float:
    """Mercator-Meter pro echtem Meter in Breite `lat` (Kartenstreckung)."""
    return 1 / math.cos(math.radians(lat))


def map_extent(
    center_lat: float, center_lon: float, radius_m: float
) -> tuple[float, float, float, float]:
    """Quadratischer Ausschnitt um den Kreis: (x_min, x_max, y_min, y_max) in Mercator-Metern."""
    cx, cy = lonlat_to_mercator(center_lat, center_lon)
    half = radius_m * mercator_scale(center_lat) * EXTENT_PAD
    return cx - half, cx + half, cy - half, cy + half
