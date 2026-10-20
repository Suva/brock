// Where the map is on screen: a point of the map at (mx, my) is drawn at
// (mx * zoom + x, my * zoom + y) in the view.

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 3;

const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** Zooms by `factor`, keeping the point of the view at (sx, sy) where it is. */
export function zoomAt(camera: Camera, factor: number, sx: number, sy: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const k = zoom / camera.zoom;
  return { zoom, x: sx - (sx - camera.x) * k, y: sy - (sy - camera.y) * k };
}

/** The map's point (mx, my) in the middle of a view `width` by `height`. */
export function centreOn(mx: number, my: number, zoom: number, width: number, height: number): Camera {
  return { zoom, x: width / 2 - mx * zoom, y: height / 2 - my * zoom };
}

/** All of `bounds` in view, no larger than at zoom 1. */
export function fit(bounds: Rect, width: number, height: number, margin = 40): Camera {
  const zoom = clampZoom(
    Math.min(1, (width - 2 * margin) / Math.max(1, bounds.width), (height - 2 * margin) / Math.max(1, bounds.height)),
  );
  return centreOn(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, zoom, width, height);
}

/**
 * The camera moved as little as it takes to show `rect`, a part of the map,
 * with `margin` around it; the same camera if it is in view already.
 */
export function reveal(camera: Camera, rect: Rect, width: number, height: number, margin = 48): Camera {
  const shift = (start: number, size: number, view: number) => {
    const m = Math.min(margin, Math.max(0, (view - size) / 2));
    if (start < m) return m - start;
    if (start + size > view - m) return Math.max(m - start, view - m - (start + size));
    return 0;
  };
  const sx = rect.x * camera.zoom + camera.x;
  const sy = rect.y * camera.zoom + camera.y;
  const dx = shift(sx, rect.width * camera.zoom, width);
  const dy = shift(sy, rect.height * camera.zoom, height);
  return dx === 0 && dy === 0 ? camera : { ...camera, x: camera.x + dx, y: camera.y + dy };
}
