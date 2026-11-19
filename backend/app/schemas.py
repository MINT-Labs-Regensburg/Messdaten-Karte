"""Pydantic-Schemas der API (siehe openapi.yaml)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Finite = Annotated[float, Field(allow_inf_nan=False)]
Lat = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Lon = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
Username = Annotated[str, Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")]
Password = Annotated[str, Field(min_length=10, max_length=256)]
Slug = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")]

ProjectRole = Literal["owner", "editor"]
MetricType = Literal["number", "scale"]
TokenScope = Literal["measurements:write", "full"]


class Credentials(BaseModel):
    username: Username
    password: Password


class LoginRequest(BaseModel):
    # Beim Login keine Passwortregeln erzwingen, sonst gäbe die Validierung Hinweise.
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)
    remember_me: bool = False


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: Password


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    is_admin: bool
    is_active: bool
    created_at: datetime


class Limits(BaseModel):
    max_radius_m: int
    max_measurements_per_project: int
    edit_window_seconds: int


class LoginResponse(BaseModel):
    user: UserOut
    csrf_token: str


class MeResponse(BaseModel):
    user: UserOut | None
    csrf_token: str | None = None
    registration_enabled: bool
    limits: Limits


class SettingsModel(BaseModel):
    registration_enabled: bool | None = None


class AdminUserCreate(Credentials):
    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None
    new_password: Password | None = None


class UserList(BaseModel):
    items: list[UserOut]
    total: int


class LatLon(BaseModel):
    lat: Lat
    lon: Lon


# ---------------------------------------------------------------- Messgrößen


class ColorStop(BaseModel):
    at: float = Field(ge=0, le=1)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class ColorScale(BaseModel):
    name: Literal["viridis", "plasma", "coolwarm", "rdylgn", "rdylgn_r", "custom"]
    stops: list[ColorStop] | None = None

    @model_validator(mode="after")
    def _check_stops(self) -> ColorScale:
        if self.name == "custom":
            if not self.stops or len(self.stops) < 2:
                raise ValueError("custom color scale needs at least two stops")
        elif self.stops:
            raise ValueError("stops are only allowed for the custom color scale")
        return self


DEFAULT_COLOR_SCALE = {"name": "viridis"}


class MetricCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    unit: str | None = Field(default=None, max_length=16)
    type: MetricType
    min: Finite
    max: Finite
    color_scale: ColorScale = Field(default_factory=lambda: ColorScale(name="viridis"))
    position: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check_range(self) -> MetricCreate:
        if self.min >= self.max:
            raise ValueError("min must be smaller than max")
        if self.type == "scale" and (self.min != int(self.min) or self.max != int(self.max)):
            raise ValueError("scale metrics need integer bounds")
        return self


class MetricUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    unit: str | None = Field(default=None, max_length=16)
    min: Finite | None = None
    max: Finite | None = None
    color_scale: ColorScale | None = None
    position: int | None = Field(default=None, ge=0)

    @field_validator("name", "min", "max", "color_scale", "position")
    @classmethod
    def _not_null(cls, v: Any) -> Any:
        if v is None:
            raise ValueError("must not be null")
        return v


class MetricOut(BaseModel):
    id: uuid.UUID
    name: str
    unit: str | None
    type: MetricType
    min: float
    max: float
    color_scale: dict[str, Any]
    position: int


# ------------------------------------------------------------------ Projekte


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: Slug | None = None
    description: str | None = Field(default=None, max_length=2000)
    center: LatLon
    radius_m: int = Field(ge=1)
    is_public: bool = False
    is_editable: bool = False
    metrics: list[MetricCreate] = []


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    slug: Slug | None = None
    description: str | None = Field(default=None, max_length=2000)
    center: LatLon | None = None
    radius_m: int | None = Field(default=None, ge=1)
    is_public: bool | None = None
    is_editable: bool | None = None

    @field_validator("name", "center", "radius_m", "is_public", "is_editable", "slug")
    @classmethod
    def _not_null(cls, v: Any) -> Any:
        if v is None:
            raise ValueError("must not be null")
        return v


class ProjectOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    center: LatLon
    radius_m: int
    is_public: bool
    is_editable: bool
    archived: bool
    measurement_count: int | None = None
    my_role: ProjectRole | None = None
    created_at: datetime


class ProjectDetail(ProjectOut):
    metrics: list[MetricOut]
    first_measurement_at: datetime | None = None
    last_measurement_at: datetime | None = None


class ProjectList(BaseModel):
    items: list[ProjectOut]
    total: int


class MemberAdd(BaseModel):
    username: str = Field(max_length=64)
    role: ProjectRole = "editor"


class MemberRoleUpdate(BaseModel):
    role: ProjectRole


class MemberOut(BaseModel):
    user_id: uuid.UUID
    username: str
    role: ProjectRole


# ----------------------------------------------------------------- Messungen


class ValueIn(BaseModel):
    metric_id: uuid.UUID
    value: Finite


class MeasurementCreate(BaseModel):
    lat: Lat
    lon: Lon
    values: list[ValueIn] = Field(min_length=1)
    author_name: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)
    measured_at: datetime | None = None


class MeasurementUpdate(BaseModel):
    values: list[ValueIn] | None = Field(default=None, min_length=1)
    author_name: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=500)
    hidden: bool | None = None

    @field_validator("values", "hidden")
    @classmethod
    def _not_null(cls, v: Any) -> Any:
        if v is None:
            raise ValueError("must not be null")
        return v


class MeasurementOut(BaseModel):
    id: uuid.UUID
    lat: float
    lon: float
    measured_at: datetime
    values: list[ValueIn]
    author_name: str | None
    note: str | None
    source: Literal["anonymous", "user", "api_token"]
    hidden: bool


class MeasurementCreated(MeasurementOut):
    edit_token: str | None = None
    edit_expires_at: datetime | None = None


class MeasurementPage(BaseModel):
    items: list[MeasurementOut]
    next_cursor: str | None = None


# ---------------------------------------------------------------- API-Tokens


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    scope: TokenScope
    project_id: uuid.UUID | None = None
    expires_at: datetime | None = None


class ApiTokenOut(BaseModel):
    id: uuid.UUID
    name: str
    scope: TokenScope
    project_id: uuid.UUID | None
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None


class ApiTokenCreated(ApiTokenOut):
    token: str


# -------------------------------------------------------------------- Export


class ExportSelect(BaseModel):
    metric_ids: list[uuid.UUID] | None = None
    from_: datetime | None = Field(default=None, alias="from")
    to: datetime | None = None
    include_hidden: bool = False
    include_notes_and_names: bool = False

    model_config = {"populate_by_name": True}


class ExportImage(BaseModel):
    metric_id: uuid.UUID | None = None
    width_px: int | None = Field(default=None, ge=100, le=8000)
    height_px: int | None = Field(default=None, ge=100, le=8000)
    dpi: int | None = Field(default=None, ge=72, le=600)
    basemap: Literal["none", "osm", "satellite"] = "none"
    show_points: bool = True
    show_legend: bool = True


class ExportRequest(BaseModel):
    format: Literal["csv", "geojson", "svg", "png", "jpeg", "video"]
    select: ExportSelect = Field(default_factory=ExportSelect)
    image: ExportImage = Field(default_factory=ExportImage)
