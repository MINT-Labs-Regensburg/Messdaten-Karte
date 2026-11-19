"""Kartenbild des Heatmap-Gitters (SVG als Vektorgrafik, PNG/JPEG als Pixelbild) mit Matplotlib."""

import io
from datetime import datetime
from typing import Any

import numpy as np
from matplotlib import colormaps
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.backends.backend_svg import FigureCanvasSVG
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.figure import Figure
from matplotlib.patches import Circle

from app.models import Metric, Project
from app.services.geo import to_local_xy

NAMED = {
    "viridis": "viridis",
    "plasma": "plasma",
    "coolwarm": "coolwarm",
    "rdylgn": "RdYlGn",
    "rdylgn_r": "RdYlGn_r",
}


def colormap_for(scale: dict[str, Any]):
    name = scale.get("name", "viridis")
    if name == "custom" and scale.get("stops"):
        stops = sorted(scale["stops"], key=lambda s: s["at"])
        return LinearSegmentedColormap.from_list("custom", [(s["at"], s["color"]) for s in stops])
    return colormaps[NAMED.get(name, "viridis")]


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
) -> bytes:
    radius = project.radius_m
    fig = Figure(figsize=(width_px / dpi, height_px / dpi), dpi=dpi)
    (FigureCanvasSVG if fmt == "svg" else FigureCanvasAgg)(fig)
    ax = fig.add_subplot(1, 1, 1)
    pad = radius * 0.05
    ax.set_xlim(-radius - pad, radius + pad)
    ax.set_ylim(-radius - pad, radius + pad)
    ax.set_aspect("equal")
    ax.set_xlabel("m")
    ax.set_ylabel("m")
    ax.set_title(f"{project.name} – {metric.name}\n{time_range}", fontsize=10)

    outline = Circle((0, 0), radius, fill=False, edgecolor="black", linewidth=1.2)
    ax.add_patch(outline)

    if heat.get("status") == "ok":
        grid = np.array(heat["grid"]["values"], dtype=float)  # None -> nan
        n = grid.shape[0]
        cell = 2 * radius / n
        xs = -radius + (np.arange(n) + 0.5) * cell
        ys = radius - (np.arange(n) + 0.5) * cell
        vr = heat["value_range"]
        vmin, vmax = vr["min"], vr["max"]
        if vmin == vmax:
            vmax = vmin + 1e-9
        levels = np.linspace(vmin, vmax, 13)
        contour = ax.contourf(
            xs,
            ys,
            np.ma.masked_invalid(grid),
            levels=levels,
            cmap=colormap_for(metric.color_scale),
            extend="both",
        )
        contour.set_clip_path(outline)
        if show_legend:
            bar = fig.colorbar(contour, ax=ax, shrink=0.8)
            bar.set_label(f"{metric.name}" + (f" [{metric.unit}]" if metric.unit else ""))
    if show_points and points:
        xy = np.array(
            [
                to_local_xy(lat, lon, project.center_lat, project.center_lon)
                for lat, lon, _ in points
            ]
        )
        ax.scatter(
            xy[:, 0], xy[:, 1], s=14, c="white", edgecolors="black", linewidths=0.7, zorder=3
        )
    buffer = io.BytesIO()
    fig.savefig(buffer, format="jpeg" if fmt == "jpeg" else fmt, dpi=dpi)
    return buffer.getvalue()


def describe_range(from_: datetime | None, to: datetime | None) -> str:
    def fmt(dt: datetime | None, fallback: str) -> str:
        return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else fallback

    return f"{fmt(from_, '…')} – {fmt(to, '…')}"
