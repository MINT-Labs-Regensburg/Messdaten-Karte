// Typen der REST-/WebSocket-API (siehe ../../openapi.yaml)

export interface User {
  id: string
  username: string
  is_admin: boolean
  is_active: boolean
  created_at: string
}

export interface Limits {
  max_radius_m: number
  max_measurements_per_project: number
  edit_window_seconds: number
}

export interface MeResponse {
  user: User | null
  csrf_token?: string | null
  registration_enabled: boolean
  limits: Limits
}

export interface LoginResponse {
  user: User
  csrf_token: string
}

export interface LatLon {
  lat: number
  lon: number
}

export type ProjectRole = 'owner' | 'editor'
export type MetricType = 'number' | 'scale'
export type ColorScaleName = 'viridis' | 'plasma' | 'coolwarm' | 'rdylgn' | 'rdylgn_r' | 'custom'

export interface ColorStop {
  at: number
  color: string
}

export interface ColorScale {
  name: ColorScaleName
  stops?: ColorStop[]
}

export interface Metric {
  id: string
  name: string
  unit: string | null
  type: MetricType
  min: number
  max: number
  color_scale: ColorScale
  position: number
}

export interface MetricInput {
  name: string
  unit: string | null
  type: MetricType
  min: number
  max: number
  color_scale: ColorScale
}

export interface Project {
  id: string
  slug: string
  name: string
  description: string | null
  center: LatLon
  radius_m: number
  is_public: boolean
  is_editable: boolean
  archived: boolean
  measurement_count?: number | null
  my_role?: ProjectRole | null
  created_at: string
}

export interface ProjectDetail extends Project {
  metrics: Metric[]
  first_measurement_at: string | null
  last_measurement_at: string | null
}

export interface ProjectList {
  items: Project[]
  total: number
}

export interface ProjectCreateBody {
  name: string
  slug?: string
  description?: string | null
  center: LatLon
  radius_m: number
  is_public: boolean
  is_editable: boolean
  metrics: MetricInput[]
}

export interface Member {
  user_id: string
  username: string
  role: ProjectRole
}

export interface ValueIn {
  metric_id: string
  value: number
}

export interface Measurement {
  id: string
  lat: number
  lon: number
  measured_at: string
  values: ValueIn[]
  author_name: string | null
  note: string | null
  source: 'anonymous' | 'user' | 'api_token'
  hidden: boolean
}

export interface MeasurementCreated extends Measurement {
  edit_token?: string | null
  edit_expires_at?: string | null
}

export interface MeasurementPage {
  items: Measurement[]
  next_cursor: string | null
}

export interface MeasurementBody {
  lat: number
  lon: number
  values: ValueIn[]
  author_name?: string | null
  note?: string | null
}

export interface Heatmap {
  status: 'ok' | 'insufficient_data' | 'failed'
  metric_id: string
  from?: string | null
  to?: string | null
  point_count?: number
  method?: 'kriging' | 'idw_fallback'
  bounds?: { south: number; west: number; north: number; east: number }
  grid?: {
    rows: number
    cols: number
    values: (number | null)[][]
    variance?: (number | null)[][]
  }
  value_range?: { min: number; max: number }
  computed_at?: string
}

export type TokenScope = 'measurements:write' | 'full'

export interface ApiToken {
  id: string
  name: string
  scope: TokenScope
  project_id: string | null
  prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

export interface ApiTokenCreated extends ApiToken {
  token: string
}

export interface UserList {
  items: User[]
  total: number
}

export type LiveEvent =
  | { type: 'measurement.created'; measurement: Measurement }
  | { type: 'measurement.updated'; measurement: Measurement }
  | { type: 'measurement.hidden'; measurement_id: string }
  | { type: 'measurement.deleted'; measurement_id: string }
  | { type: 'project.updated'; project: Project }
  | { type: 'project.archived' }

export type ExportFormat = 'csv' | 'geojson' | 'svg' | 'png' | 'jpeg'

export interface ExportRequest {
  format: ExportFormat
  select: {
    metric_ids?: string[]
    from?: string
    to?: string
    include_hidden: boolean
    include_notes_and_names: boolean
  }
  image?: {
    metric_id?: string
    width_px?: number
    height_px?: number
    basemap: 'none'
    show_points: boolean
    show_legend: boolean
  }
}
