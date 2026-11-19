"""Kartenbild des Heatmap-Gitters (SVG als Vektorgrafik, PNG/JPEG optional mit Hintergrundkarte)."""

import io
import math
from datetime import datetime
from typing import Any

import numpy as np
from matplotlib import colormaps
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.backends.backend_svg import FigureCanvasSVG
from matplotlib.cm import ScalarMappable
from matplotlib.colors import LinearSegmentedColormap, Normalize
from matplotlib.figure import Figure
from matplotlib.patches import Polygon, Rectangle
from matplotlib.ticker import FormatStrFormatter

from app.models import Metric, Project
from app.services.geo import lonlat_to_mercator, map_extent, mercator_scale
from app.services.tiles import Basemap

NAMED = {
    "viridis": "viridis",
    "plasma": "plasma",
    "coolwarm": "coolwarm",
    "rdylgn": "RdYlGn",
    "rdylgn_r": "RdYlGn_r",
}
SCALE_STEPS_M = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]


def colormap_for(scale: dict[str, Any]):
    name = scale.get("name", "viridis")
    if name == "custom" and scale.get("stops"):
        stops = sorted(scale["stops"], key=lambda s: s["at"])
        return LinearSegmentedColormap.from_list("custom", [(s["at"], s["color"]) for s in stops])
    return colormaps[NAMED.get(name, "viridis")]


def _nice_length(radius_m: float) -> int:
    """Länge des Maßstabsbalkens: größte runde Zahl bis etwa 60 % des Radius."""
    fitting = [s for s in SCALE_STEPS_M if s <= radius_m * 0.6]
    return fitting[-1] if fitting else SCALE_STEPS_M[0]


def render_map(
    *,
    fmt: str,
    project: Project,
    metric: Metric,
    heat: dict[str, Any],
    points: list[tuple[float, float, float]],
    time_range: str,
    width_px: int,
    height_px: int,
    dpi: int,
    show_points: bool,
    show_legend: bool,
    basemap: Basemap | None = None,
) -> bytes:
    """Zeichnet in Web-Mercator-Koordinaten, damit die Kacheln der Hintergrundkarte passen."""
    lat0, lon0 = project.center_lat, project.center_lon
    k = mercator_scale(lat0)
    cx, cy = lonlat_to_mercator(lat0, lon0)
    x_min, x_max, y_min, y_max = map_extent(lat0, lon0, project.radius_m)
    fs = max(9.0, width_px / dpi * 0.75)  # Schriftgröße wächst mit der Bildgröße

    fig = Figure(figsize=(width_px / dpi, height_px / dpi), dpi=dpi, layout="constrained")
    fig.patch.set_facecolor("white")
    (FigureCanvasSVG if fmt == "svg" else FigureCanvasAgg)(fig)
    ax = fig.add_subplot(1, 1, 1)
    ax.set_aspect("equal")
    ax.set_axis_off()
    title = f"{project.name} – {metric.name}" + (f"\n{time_range}" if time_range else "")
    ax.set_title(title, fontsize=fs)

    if basemap is not None:
        left, right, bottom, top = basemap.extent
        ax.imshow(
            np.asarray(basemap.image),
            extent=(left, right, bottom, top),
            origin="upper",
            interpolation="bilinear",
            zorder=0,
        )
    else:
        ax.add_patch(
            Rectangle((x_min, y_min), x_max - x_min, y_max - y_min, facecolor="#eef3e6", zorder=0)
        )
    ax.set_xlim(x_min, x_max)
    ax.set_ylim(y_min, y_max)

    # Kreis in Mercator-Koordinaten (Streckung k um den Mittelpunkt)
    angles = np.linspace(0, 2 * math.pi, 181)
    ring = np.column_stack(
        [cx + project.radius_m * k * np.cos(angles), cy + project.radius_m * k * np.sin(angles)]
    )
    outline = Polygon(
        ring, closed=True, fill=False, edgecolor="#14281d", linewidth=1.6, linestyle="--", zorder=4
    )
    ax.add_patch(outline)

    cmap = colormap_for(metric.color_scale)
    if heat.get("status") == "ok":
        low, high = heat["value_range"]["min"], heat["value_range"]["max"]
    elif points:
        values = [v for _, _, v in points]
        low, high = min(values), max(values)
    else:
        low, high = metric.min, metric.max
    if high <= low:  # konstante Werte: Skala um den Wert herum aufspannen
        low, high = low - 0.5, high + 0.5
    norm = Normalize(vmin=low, vmax=high)

    contour = None
    if heat.get("status") == "ok":
        grid = np.array(heat["grid"]["values"], dtype=float)  # None -> nan
        n = grid.shape[0]
        cell = 2 * project.radius_m / n
        alpha = 0.78 if basemap is not None else 1.0
        if fmt == "svg":
            # Vektor: gefüllte Konturflächen
            xs = cx + (-project.radius_m + (np.arange(n) + 0.5) * cell) * k
            ys = cy + (project.radius_m - (np.arange(n) + 0.5) * cell) * k
            contour = ax.contourf(
                xs,
                ys,
                np.ma.masked_invalid(grid),
                levels=np.linspace(low, high, 21),
                cmap=cmap,
                norm=norm,
                extend="both",
                alpha=alpha,
                zorder=2,
            )
            contour.set_clip_path(outline)
        else:
            # Pixelbild: glatt interpoliertes Gitter (wie die Karte im Browser), ohne Stufen-Nähte
            outside = np.isnan(grid)
            rgba = cmap(norm(np.where(outside, low, grid)))
            rgba[..., 3] = np.where(outside, 0.0, alpha)
            r = project.radius_m * k
            overlay = ax.imshow(
                rgba,
                extent=(cx - r, cx + r, cy - r, cy + r),
                origin="upper",
                interpolation="bilinear",
                zorder=2,
            )
            overlay.set_clip_path(outline)

    if show_points and points:
        coords = np.array([lonlat_to_mercator(lat, lon) for lat, lon, _ in points])
        ax.scatter(
            coords[:, 0],
            coords[:, 1],
            c=[v for _, _, v in points],
            cmap=cmap,
            norm=norm,
            s=fs * 5,
            edgecolors="#14281d",
            linewidths=1.0,
            zorder=5,
        )

    if show_legend:
        bar = fig.colorbar(
            contour or ScalarMappable(norm=norm, cmap=cmap),
            ax=ax,
            orientation="horizontal",
            location="bottom",
            shrink=0.7,
            aspect=40,
            pad=0.02,
        )
        bar.set_ticks(np.linspace(low, high, 5))
        bar.ax.xaxis.set_major_formatter(FormatStrFormatter("%.4g"))
        if fmt == "svg" and bar.solids is not None:
            bar.solids.set_rasterized(False)  # Vektorgrafik ohne eingebettetes Pixelbild
        bar.set_label(metric.name + (f" [{metric.unit}]" if metric.unit else ""), fontsize=fs)
        bar.ax.tick_params(labelsize=fs * 0.9)

    # Maßstab links unten
    length = _nice_length(project.radius_m)
    pad = (x_max - x_min) * 0.04
    x0, y0 = x_min + pad, y_min + pad
    ax.plot(
        [x0, x0 + length * k],
        [y0, y0],
        color="white",
        linewidth=5.5,
        solid_capstyle="butt",
        zorder=8,
    )
    ax.plot(
        [x0, x0 + length * k],
        [y0, y0],
        color="#14281d",
        linewidth=3,
        solid_capstyle="butt",
        zorder=9,
    )
    label = f"{length // 1000} km" if length >= 1000 else f"{length} m"
    ax.text(
        x0,
        y0 + pad * 0.5,
        label,
        fontsize=fs * 0.9,
        zorder=10,
        bbox={"facecolor": "white", "alpha": 0.75, "pad": 1.5, "linewidth": 0},
    )

    if basemap is not None:  # Quellenangabe ist Pflicht (Nutzungsbedingungen der Kachelserver)
        ax.text(
            x_max - pad * 0.3,
            y_min + pad * 0.3,
            basemap.attribution,
            ha="right",
            va="bottom",
            fontsize=fs * 0.7,
            zorder=10,
            bbox={"facecolor": "white", "alpha": 0.8, "pad": 2, "linewidth": 0},
        )

    ax.set_xlim(x_min, x_max)  # imshow setzt die Grenzen zurück
    ax.set_ylim(y_min, y_max)
    buffer = io.BytesIO()
    fig.savefig(buffer, format="jpeg" if fmt == "jpeg" else fmt, dpi=dpi)
    return buffer.getvalue()


def describe_range(from_: datetime | None, to: datetime | None) -> str:
    """Zeitbereich für den Titel; ohne Grenzen (gesamter Zeitraum) bleibt die Zeile leer."""
    if from_ is None and to is None:
        return ""

    def fmt(dt: datetime | None) -> str:
        return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "…"

    return f"{fmt(from_)} – {fmt(to)}"
