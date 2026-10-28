/* Seguimiento GPS: recortar solo la línea recorrida.
 * Los marcadores pertenecen a otra capa y nunca se eliminan desde aquí.
 * El progreso se mide en metros y solo avanza; no recalcula la ruta.
 */
class DrivingProgress {
  constructor(points) {
    this.points = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i++) this.lengths[i] = this.lengths[i - 1] + DrivingProgress.distance(this.points[i - 1], this.points[i]);
    this.progress = 0;
    this.last = null;
    this.lastTime = null;
    this.started = false;
  }
  static distance(a, b) {
    const y = (b[0] - a[0]) * 111195,
      x = (b[1] - a[1]) * 111195 * Math.cos((a[0] + b[0]) * Math.PI / 360);
    return Math.hypot(x, y)
  }
  at(m) {
    if (this.points.length < 2) return this.points[0] || [0, 0];
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i] < m) i++;
    const a = this.points[i - 1],
      b = this.points[i] || a,
      t = Math.max(0, Math.min(1, (m - this.lengths[i - 1]) / (this.lengths[i] - this.lengths[i - 1] || 1)));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  remaining() {
    return [this.at(this.progress), ...this.points.filter((_, i) => this.lengths[i] > this.progress)]
  }
  update(lat, lon, accuracy, time) {
    // Una señal imprecisa no debe borrar partes de la ruta por error.
    if (![lat, lon, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > 50) {
      return 'weak';
    }
    const total = this.lengths.at(-1);
    if (this.points.length < 2 || total - this.progress < 5) return 'done';

    const pt = [lat, lon];
    const now = Number.isFinite(time) ? time : Date.now();
    if (this.lastTime !== null && now <= this.lastTime) return 'weak';

    // Al iniciar o reabrir, localizar el móvil en el recorrido pendiente,
    // aunque ya haya pasado más de 100 metros desde el punto de salida.
    let end = total;
    if (this.last) {
      const movement = DrivingProgress.distance(this.last, pt);
      const elapsed = (now - this.lastTime) / 1000;
      if (movement > Math.max(100, elapsed * 55)) return 'weak';
      const advance = Math.min(3000, Math.max(60, movement + accuracy * 2 + 25, elapsed * 40));
      end = Math.min(total, this.progress + advance);
    }

    const candidates = [];
    const scale = 111195 * Math.cos(lat * Math.PI / 180);
    for (let i = 1; i < this.points.length; i++) {
      if (this.lengths[i] < this.progress || this.lengths[i - 1] > end) continue;
      const a = this.points[i - 1];
      const b = this.points[i];
      const ax = (a[1] - lon) * scale;
      const ay = (a[0] - lat) * 111195;
      const dx = (b[1] - a[1]) * scale;
      const dy = (b[0] - a[0]) * 111195;
      const len = this.lengths[i] - this.lengths[i - 1];
      if (!len) continue;
      const projection = -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1);
      const low = Math.max(0, (this.progress - this.lengths[i - 1]) / len);
      const high = Math.min(1, (end - this.lengths[i - 1]) / len);
      const t = Math.max(low, Math.min(high, projection));
      candidates.push({
        distance: Math.hypot(ax + t * dx, ay + t * dy),
        m: this.lengths[i - 1] + t * len
      });
    }

    const tolerance = Math.min(40, Math.max(12, accuracy));
    const nearest = candidates.reduce((d, c) => Math.min(d, c.distance), Infinity);
    if (nearest > tolerance) return 'off';

    // Ante calles repetidas o cruces ambiguos, preferir la primera visita
    // pendiente dentro del margen de precisión, no una vuelta posterior.
    const best = candidates.find(c => c.distance <= Math.min(tolerance, nearest + 8));
    this.last = pt;
    this.lastTime = now;
    this.started = true;
    this.progress = Math.max(this.progress, best.m);
    return total - this.progress < 5 ? 'done' : 'ok';
  }

}
class DrivingRouteDisplay {
  constructor(map, points) {
    this.map = map;
    this.progress = new DrivingProgress(points);
    this.group = L.layerGroup().addTo(map);
    this.redraw = () => this.draw();
    map.on('zoomend', this.redraw);
    this.draw()
  }
  getBounds() {
    return L.latLngBounds(this.progress.points)
  }
  remove() {
    this.map.off('zoomend', this.redraw);
    this.map.removeLayer(this.group)
  }
  update(p) {
    const state = this.progress.update(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.timestamp);
    if (state === 'ok' || state === 'done') this.draw();
    return state
  }
  draw() {
    // Esta capa contiene únicamente la línea y sus flechas, nunca paradas.
    this.group.clearLayers();
    if (this.progress.lengths.at(-1) - this.progress.progress < 5) return;
    const raw = this.progress.remaining().map(p => this.map.project(p, this.map.getZoom())),
      offset = 4;
    const shifted = raw.map((p, i) => {
      const a = raw[Math.max(0, i - 1)],
        b = raw[Math.min(raw.length - 1, i + 1)],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy) || 1;
      return L.point(p.x - dy / len * offset, p.y + dx / len * offset)
    });
    const latlng = p => this.map.unproject(p, this.map.getZoom());
    L.polyline(shifted.map(latlng), {
      color: '#2579f3',
      weight: 6,
      opacity: .95,
      interactive: false
    }).addTo(this.group);
    let next = 24;
    for (let i = 1; i < shifted.length; i++) {
      const a = shifted[i - 1],
        b = shifted[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        len = Math.hypot(dx, dy);
      if (!len) continue;
      while (next < len) {
        const t = next / len,
          x = a.x + dx * t,
          y = a.y + dy * t,
          ux = dx / len,
          uy = dy / len;
        const tip = L.point(x + ux * 3, y + uy * 3),
          left = L.point(x - ux * 3 - uy * 2, y - uy * 3 + ux * 2),
          right = L.point(x - ux * 3 + uy * 2, y - uy * 3 - ux * 2);
        L.polyline([left, tip, right].map(latlng), {
          color: '#fff',
          weight: 1.8,
          opacity: 1,
          interactive: false
        }).addTo(this.group);
        next += 65;
      }
      next -= len;
    }
  }
}
window.DrivingProgress = DrivingProgress;
window.DrivingRouteDisplay = DrivingRouteDisplay;
