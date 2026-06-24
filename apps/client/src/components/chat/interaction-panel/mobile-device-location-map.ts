const defaultMapZoom = 15
const tileSize = 256
const maxMercatorLatitude = 85.05112878

export interface MobileLocationCoordinate {
  latitude: number
  longitude: number
}

export interface MobileLocationMapClickInput extends MobileLocationCoordinate {
  clientX: number
  clientY: number
  rect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>
  zoom?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const normalizeLongitude = (longitude: number) => {
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

const roundCoordinate = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(rounded, -0) ? 0 : rounded
}

const worldSizeForZoom = (zoom: number) => tileSize * 2 ** zoom

const longitudeToWorldX = (longitude: number, zoom: number) => (
  (normalizeLongitude(longitude) + 180) / 360 * worldSizeForZoom(zoom)
)

const latitudeToWorldY = (latitude: number, zoom: number) => {
  const clampedLatitude = clamp(latitude, -maxMercatorLatitude, maxMercatorLatitude)
  const sinLatitude = Math.sin(clampedLatitude * Math.PI / 180)
  return (
    (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) *
    worldSizeForZoom(zoom)
  )
}

const worldXToLongitude = (worldX: number, zoom: number) => (
  worldX / worldSizeForZoom(zoom) * 360 - 180
)

const worldYToLatitude = (worldY: number, zoom: number) => {
  const y = 0.5 - worldY / worldSizeForZoom(zoom)
  return 90 - 360 * Math.atan(Math.exp(-y * 2 * Math.PI)) / Math.PI
}

export const buildMobileLocationMapUrl = ({
  latitude,
  longitude,
  zoom = defaultMapZoom
}: MobileLocationCoordinate & { zoom?: number }) => {
  const query = `${latitude.toFixed(6)},${longitude.toFixed(6)}`
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${zoom}&output=embed`
}

export const resolveMobileLocationMapClick = ({
  clientX,
  clientY,
  latitude,
  longitude,
  rect,
  zoom = defaultMapZoom
}: MobileLocationMapClickInput): MobileLocationCoordinate => {
  if (rect.width <= 0 || rect.height <= 0) {
    return {
      latitude: roundCoordinate(clamp(latitude, -90, 90)),
      longitude: roundCoordinate(normalizeLongitude(longitude))
    }
  }

  const centerX = longitudeToWorldX(longitude, zoom)
  const centerY = latitudeToWorldY(latitude, zoom)
  const offsetX = clientX - (rect.left + rect.width / 2)
  const offsetY = clientY - (rect.top + rect.height / 2)
  const nextLatitude = worldYToLatitude(centerY + offsetY, zoom)
  const nextLongitude = worldXToLongitude(centerX + offsetX, zoom)

  return {
    latitude: roundCoordinate(clamp(nextLatitude, -90, 90)),
    longitude: roundCoordinate(normalizeLongitude(nextLongitude))
  }
}
