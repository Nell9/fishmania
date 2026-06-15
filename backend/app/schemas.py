"""Pydantic-контракты запросов и ответов /api/ai/*."""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class WaterProfile(BaseModel):
    type: str = "lake"
    typeName: Optional[str] = None
    name: Optional[str] = None
    lat: float = 55.0
    areaHa: Optional[float] = None
    widthM: Optional[float] = None
    sizeClass: Optional[str] = "unknown"
    connectivity: float = 0.0
    reeds: bool = False
    bridge: bool = False
    linear: bool = False
    dataQuality: str = "inferred"


class Weather(BaseModel):
    waterTemp: Optional[float] = None
    airTemp: Optional[float] = None
    pressureMm: Optional[float] = None
    pressureTrend: Optional[Any] = None   # число (мм/сутки) или метка
    windMs: Optional[float] = None
    windDir: Optional[float] = None
    clouds: Optional[float] = None
    precip: Optional[float] = None


class AnalyzeRequest(BaseModel):
    profile: WaterProfile
    month: Optional[int] = None
    waterTemp: Optional[float] = None
    provider: Optional[str] = None        # 'claude' | 'local' | None(=auto)


class SpeciesOut(BaseModel):
    id: str
    name: str
    confidence: float
    basis: Optional[str] = None
    basisLabel: Optional[str] = None
    rationale: Optional[str] = None
    evidence: List[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    provider: str
    dataQuality: str
    summary: str
    top: Optional[str] = None
    species: List[SpeciesOut]
    notes: List[str] = Field(default_factory=list)
    sources: List[str] = Field(default_factory=list)


class TacticsRequest(BaseModel):
    species: str                          # id вида
    profile: WaterProfile
    weather: Weather = Field(default_factory=Weather)
    month: Optional[int] = None
    period: Optional[str] = "day"         # dawn|day|dusk|night
    tackle: Optional[str] = None
    baits: List[str] = Field(default_factory=list)
    provider: Optional[str] = None


class Tactic(BaseModel):
    title: str
    text: str


class BaitOut(BaseModel):
    name: str
    score: float
    why: Optional[str] = None


class SpotTip(BaseModel):
    title: str
    tip: str


class TacticsResponse(BaseModel):
    provider: str
    species: Dict[str, str]
    chancePct: int
    verdict: Dict[str, str]
    tactics: List[Tactic]
    baits: List[BaitOut] = Field(default_factory=list)
    spots: List[SpotTip] = Field(default_factory=list)
    rationale: Optional[str] = None
    sources: List[str] = Field(default_factory=list)
