import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'

import type { LatLon } from '../api/types'
import { parseDecimal } from '../lib/format'
import { OSM } from '../lib/tiles'

interface AreaPickerProps {
  center: LatLon | null
  radius: number
  maxRadius: number
  onChange: (value: { center: LatLon; radius: number }) => void
}

const handleIcon = L.divIcon({ className: 'center-handle', iconSize: [28, 28], iconAnchor: [14, 14] })

function ClickToSet({ onPick }: { onPick: (c: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) })
  return null
}

/** Hält den Kreis sichtbar, wenn Mittelpunkt oder Radius über die Felder geändert werden. */
function KeepVisible({ center, radius }: { center: LatLon | null; radius: number }) {
  const map = useMap()
  const first = useRef(true)
  useEffect(() => {
    if (!center) return
    const bounds = L.latLng(center.lat, center.lon).toBounds(radius * 2.4)
    map.invalidateSize()
    if (first.current || !map.getBounds().contains(bounds)) {
      map.fitBounds(bounds, { animate: !first.current })
    }
    first.current = false
  }, [map, center, radius])
  return null
}

export function AreaPicker({ center, radius, maxRadius, onChange }: AreaPickerProps) {
  const { t } = useTranslation()
  const current = center ?? { lat: 0, lon: 0 }
  const eventHandlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng()
        onChange({ center: { lat: ll.lat, lon: ll.lng }, radius })
      },
    }),
    [onChange, radius],
  )

  const locate = () => {
    navigator.geolocation?.getCurrentPosition((pos) =>
      onChange({ center: { lat: pos.coords.latitude, lon: pos.coords.longitude }, radius }),
    )
  }

  const setCoord = (key: 'lat' | 'lon', text: string) => {
    const value = parseDecimal(text)
    if (value === null || Number.isNaN(value)) return
    const limit = key === 'lat' ? 90 : 180
    if (Math.abs(value) > limit) return
    onChange({ center: { ...current, [key]: value }, radius })
  }

  return (
    <div className="stack">
      <div className="area-map">
        <MapContainer
          center={center ? [center.lat, center.lon] : [51.1657, 10.4515]}
          zoom={center ? 15 : 6}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url={OSM.url} attribution={OSM.attribution} />
          <ClickToSet onPick={(c) => onChange({ center: c, radius })} />
          <KeepVisible center={center} radius={radius} />
          {center && (
            <>
              <Circle
                center={[center.lat, center.lon]}
                radius={radius}
                pathOptions={{ className: 'area-circle', color: '#236B47', weight: 3, dashArray: '9 6', fillOpacity: 0.12 }}
              />
              <Marker
                position={[center.lat, center.lon]}
                icon={handleIcon}
                draggable
                eventHandlers={eventHandlers}
                keyboard={false}
              />
            </>
          )}
        </MapContainer>
        {!center && <div className="area-hint">{t('area.pick_hint')}</div>}
      </div>

      <div className="row wrap">
        <label className="field grow">
          <span>{t('area.radius', { max: maxRadius })}</span>
          <span className="row">
            <input
              type="range"
              className="range"
              min={10}
              max={maxRadius}
              step={10}
              value={Math.min(radius, maxRadius)}
              aria-label={t('area.radius_label')}
              onChange={(e) => center && onChange({ center, radius: Number(e.target.value) })}
              disabled={!center}
            />
            <strong className="disp radius-value">{t('area.meters', { m: radius })}</strong>
          </span>
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>{t('area.lat')}</span>
          <input
            className="input"
            inputMode="decimal"
            key={`lat-${center?.lat ?? ''}`}
            defaultValue={center ? center.lat.toFixed(5) : ''}
            onBlur={(e) => setCoord('lat', e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('area.lon')}</span>
          <input
            className="input"
            inputMode="decimal"
            key={`lon-${center?.lon ?? ''}`}
            defaultValue={center ? center.lon.toFixed(5) : ''}
            onBlur={(e) => setCoord('lon', e.target.value)}
          />
        </label>
        <div className="form-grid-full">
          <button type="button" className="btn btn-soft" onClick={locate}>
            {t('map.my_location')}
          </button>
        </div>
      </div>
    </div>
  )
}
