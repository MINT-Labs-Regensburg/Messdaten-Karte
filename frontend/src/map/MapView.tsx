import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { memo, useEffect, useMemo } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'

import type { Heatmap, Measurement, Metric, ProjectDetail } from '../api/types'
import { colorAt, normalize } from '../lib/colorScales'
import { ESRI, OSM } from '../lib/tiles'
import { renderHeatmapDataUrl } from './heatCanvas'

export interface DraftPoint {
  lat: number
  lon: number
}

export interface UserLocation extends DraftPoint {
  accuracy?: number
}

interface MapViewProps {
  project: ProjectDetail
  metric?: Metric
  measurements: Measurement[]
  heatmap?: Heatmap
  basemap: 'street' | 'satellite'
  dark: boolean
  draft: DraftPoint | null
  selectedId: string | null
  userLocation: UserLocation | null
  focus: { lat: number; lon: number; nonce: number } | null
  onMapClick: (point: DraftPoint) => void
  onSelect: (id: string | null) => void
}

function Clicks({ onMapClick }: { onMapClick: (p: DraftPoint) => void }) {
  useMapEvents({ click: (e) => onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng }) })
  return null
}

function FitProject({ project }: { project: ProjectDetail }) {
  const map = useMap()
  useEffect(() => {
    const bounds = L.latLng(project.center.lat, project.center.lon).toBounds(project.radius_m * 2.3)
    // Leaflet merkt sich die Containergröße; nach Layout-Änderungen muss sie neu gelesen werden
    map.invalidateSize()
    map.fitBounds(bounds, { animate: false })
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map, project.id, project.center.lat, project.center.lon, project.radius_m])
  return null
}

function FlyTo({ focus }: { focus: MapViewProps['focus'] }) {
  const map = useMap()
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 17), { duration: 0.6 })
  }, [map, focus])
  return null
}

function HeatLayer({ heatmap, metric }: { heatmap?: Heatmap; metric?: Metric }) {
  const map = useMap()
  const url = useMemo(
    () => (heatmap && metric ? renderHeatmapDataUrl(heatmap, metric.color_scale) : null),
    [heatmap, metric],
  )
  useEffect(() => {
    if (!map.getPane('heat')) {
      const pane = map.createPane('heat')
      pane.style.zIndex = '350'
      pane.style.pointerEvents = 'none'
    }
  }, [map])
  useEffect(() => {
    if (!url || !heatmap?.bounds) return
    const { south, west, north, east } = heatmap.bounds
    const overlay = L.imageOverlay(
      url,
      [
        [south, west],
        [north, east],
      ],
      { opacity: 0.8, interactive: false, pane: 'heat', className: 'heat-overlay' },
    )
    overlay.addTo(map)
    return () => {
      overlay.remove()
    }
  }, [map, url, heatmap?.bounds])
  return null
}

interface PointProps {
  m: Measurement
  fill: string
  selected: boolean
  onSelect: (id: string) => void
}

const Point = memo(function Point({ m, fill, selected, onSelect }: PointProps) {
  return (
    <CircleMarker
      center={[m.lat, m.lon]}
      radius={selected ? 10 : 7}
      bubblingMouseEvents={false}
      pathOptions={{
        className: m.hidden ? 'point point-hidden' : 'point',
        fillColor: fill,
        fillOpacity: m.hidden ? 0.45 : 1,
        // dunkler Rand: auf jeder Heatmap-Farbe und auf hellen wie dunklen Kacheln gut sichtbar
        color: selected ? '#D98324' : '#14281D',
        weight: selected ? 4 : 2,
        dashArray: m.hidden ? '3 3' : undefined,
      }}
      eventHandlers={{ click: () => onSelect(m.id) }}
    />
  )
})

export function MapView(props: MapViewProps) {
  const { project, metric, measurements, heatmap, basemap, dark, draft, selectedId, userLocation, focus } = props
  const tiles = basemap === 'satellite' ? ESRI : OSM

  const points = useMemo(
    () =>
      measurements.map((m) => {
        const value = metric ? m.values.find((v) => v.metric_id === metric.id)?.value : undefined
        const fill =
          metric && value !== undefined
            ? colorAt(metric.color_scale, normalize(value, metric.min, metric.max))
            : '#9AA79F'
        return { m, fill }
      }),
    [measurements, metric],
  )

  return (
    <MapContainer
      center={[project.center.lat, project.center.lon]}
      zoom={15}
      zoomControl={false}
      attributionControl={false}
      preferCanvas
      className={`map-canvas ${basemap === 'street' && dark ? 'map-dark' : ''}`}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer key={basemap} url={tiles.url} maxZoom={19} />
      <FitProject project={project} />
      <FlyTo focus={focus} />
      <ZoomControl position="bottomright" />
      <Clicks onMapClick={props.onMapClick} />
      <HeatLayer heatmap={heatmap} metric={metric} />
      <Circle
        center={[project.center.lat, project.center.lon]}
        radius={project.radius_m}
        interactive={false}
        pathOptions={{ className: 'area-circle', color: '#236B47', weight: 3, dashArray: '9 6', fill: false }}
      />
      {points.map(({ m, fill }) => (
        <Point key={m.id} m={m} fill={fill} selected={m.id === selectedId} onSelect={props.onSelect} />
      ))}
      {userLocation && userLocation.accuracy !== undefined && (
        <Circle
          center={[userLocation.lat, userLocation.lon]}
          radius={userLocation.accuracy}
          interactive={false}
          pathOptions={{ color: '#2E7A9E', weight: 1, fillOpacity: 0.12 }}
        />
      )}
      {userLocation && (
        <CircleMarker
          center={[userLocation.lat, userLocation.lon]}
          radius={8}
          interactive={false}
          pathOptions={{ fillColor: '#2E7A9E', fillOpacity: 1, color: '#ffffff', weight: 3 }}
        />
      )}
      {draft && (
        <>
          <CircleMarker
            center={[draft.lat, draft.lon]}
            radius={16}
            interactive={false}
            pathOptions={{ color: '#D98324', weight: 2, fill: false, opacity: 0.6 }}
          />
          <CircleMarker
            center={[draft.lat, draft.lon]}
            radius={8}
            interactive={false}
            pathOptions={{ fillColor: '#D98324', fillOpacity: 1, color: '#ffffff', weight: 3 }}
          />
        </>
      )}
    </MapContainer>
  )
}
