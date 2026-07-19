export interface LapRec {
  lap: number;
  start: number | null;
  end: number | null;
  time: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  compound: string;
  tyreLife: number | null;
  stint: number | null;
  position: number | null;
  pitIn: number | null;
  pitOut: number | null;
}

export interface Telemetry {
  i0: number;
  n: number;
  x: number[];
  y: number[];
  z: number[];
  speed: number[];
  rpm: number[];
  throttle: number[];
  gear: number[];
  brake: number[];
  drs: number[];
  pos: number[];
  prog: number[];
  gap: number[];
}

export interface Driver {
  number: string;
  abbrev: string;
  name: string;
  team: string;
  color: string;
  grid: number;
  finishPos: number | null;
  status: string;
  dnf: boolean;
  points: number;
  pitStops: number;
  laps: LapRec[];
  tel: Telemetry;
}

export interface Corner {
  n: number;
  letter: string;
  x: number;
  y: number;
}

export interface TrackData {
  centerline: number[][]; // [x, y, z] in decimetres
  sectors: number[][]; // [x, y] sector boundary points (s1/s2, s2/s3)
  corners: Corner[];
  pitlane: number[][];
}

export type EventType =
  | 'start' | 'pit' | 'fastest' | 'overtake' | 'position'
  | 'sc' | 'vsc' | 'yellow' | 'red' | 'green' | 'retire' | 'penalty';

export interface RaceEvent {
  t: number;
  type: EventType;
  msg: string;
  driver: string | null;
  lap: number | null;
}

export interface Period {
  start: number;
  end: number;
  type: 'sc' | 'vsc' | 'yellow' | 'red';
}

export interface RaceData {
  id: string;
  season: number;
  round: number;
  name: string;
  officialName: string;
  location: string;
  country: string;
  date: string;
  session: string;
  totalLaps: number;
  trackLength: number;
  t0: number;
  dt: number;
  nFrames: number;
  raceStart: number;
  raceEnd: number;
  track: TrackData;
  periods: Period[];
  events: RaceEvent[];
  drivers: Driver[];
}

export interface ManifestRace {
  id: string;
  season: number;
  round: number;
  name: string;
  location: string;
  country: string;
  date: string;
  session: string;
  laps: number;
  winner: string | null;
  file: string;
}

export interface ScheduleEntry {
  round: number;
  name: string;
  location: string;
  country: string;
  date: string;
}

export interface Manifest {
  races: ManifestRace[];
  schedules: Record<string, ScheduleEntry[]>;
}

export type ViewMode = 'overview' | 'follow' | 'onboard';
