const toRgba = (hex, alpha) => {
    if (!hex || typeof hex !== 'string' || hex[0] !== '#') return `rgba(255,255,255,${alpha})`;
    const clean = hex.replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean.padEnd(6, '0').slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
};

class DrawingPaneRenderer {
    constructor(source) {
        this._source = source;
    }

    draw(target) {
        const drawings = this._source.drawings();
        if (!drawings || drawings.length === 0) return;

        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            const w = mediaSize.width;
            context.save();
            context.lineCap = 'round';
            context.lineJoin = 'round';

            drawings.forEach((d) => {
                if (!d) return;
                const color = d.color || '#ffffff';
                const width = d.width || 1;

                if (d.type === 'hline' && d.screenY !== undefined) {
                    context.beginPath();
                    context.strokeStyle = color;
                    context.lineWidth = width;
                    context.setLineDash([]);
                    context.moveTo(0, d.screenY);
                    context.lineTo(w, d.screenY);
                    context.stroke();
                    return;
                }

                if (d.type === 'trendline' && d.screenPoints && d.screenPoints.length >= 2) {
                    const [p1, p2] = d.screenPoints;
                    context.beginPath();
                    context.strokeStyle = color;
                    context.lineWidth = width;
                    context.setLineDash([]);
                    context.moveTo(p1.x, p1.y);
                    context.lineTo(p2.x, p2.y);
                    context.stroke();
                    return;
                }

                if (d.type === 'rect' && d.screenPoints && d.screenPoints.length >= 2) {
                    const [p1, p2] = d.screenPoints;
                    const x = Math.min(p1.x, p2.x);
                    const y = Math.min(p1.y, p2.y);
                    const rw = Math.abs(p2.x - p1.x);
                    const rh = Math.abs(p2.y - p1.y);
                    context.beginPath();
                    context.fillStyle = toRgba(color, 0.12);
                    context.strokeStyle = color;
                    context.lineWidth = width;
                    context.setLineDash([]);
                    context.rect(x, y, rw, rh);
                    context.fill();
                    context.stroke();
                    return;
                }

                if (d.type === 'channel' && d.screenPoints && d.screenPoints.length >= 3) {
                    const [p0, p1, p2] = d.screenPoints;
                    const dx = p1.x - p0.x;
                    const dy = p1.y - p0.y;
                    const p3 = { x: p2.x - dx, y: p2.y - dy };
                    const p4 = { x: p2.x, y: p2.y };

                    context.strokeStyle = color;
                    context.lineWidth = width || 2;
                    context.setLineDash([]);
                    context.beginPath();
                    context.moveTo(p0.x, p0.y);
                    context.lineTo(p1.x, p1.y);
                    context.stroke();

                    context.beginPath();
                    context.moveTo(p3.x, p3.y);
                    context.lineTo(p4.x, p4.y);
                    context.stroke();

                    context.strokeStyle = toRgba(color, 0.7);
                    context.lineWidth = 1;
                    context.setLineDash([4, 2]);
                    context.beginPath();
                    context.moveTo((p0.x + p3.x) / 2, (p0.y + p3.y) / 2);
                    context.lineTo((p1.x + p4.x) / 2, (p1.y + p4.y) / 2);
                    context.stroke();

                    context.setLineDash([2, 2]);
                    context.beginPath();
                    context.moveTo(p0.x, p0.y);
                    context.lineTo(p3.x, p3.y);
                    context.stroke();
                    context.beginPath();
                    context.moveTo(p1.x, p1.y);
                    context.lineTo(p4.x, p4.y);
                    context.stroke();
                    context.setLineDash([]);
                    return;
                }

                if (d.type === 'fib' && d.screenPoints && d.screenPoints.length >= 3) {
                    const [p0, p1, p2] = d.screenPoints;
                    const shiftX = p2.x - p1.x;
                    const shiftY = p2.y - p1.y;
                    const ratios = d.fibRatios || [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.382, 1.618, 2.618, 3.618];

                    ratios.forEach((r) => {
                        const visible = d.fibVisible ? d.fibVisible[r] !== false : r <= 1;
                        if (!visible) return;
                        const fx1 = p0.x + shiftX * r;
                        const fy1 = p0.y + shiftY * r;
                        const fx2 = p1.x + shiftX * r;
                        const fy2 = p1.y + shiftY * r;
                        const levelColor = (d.fibColors && d.fibColors[r]) ? d.fibColors[r] : color;

                        context.beginPath();
                        context.strokeStyle = levelColor;
                        context.lineWidth = width || 2;
                        context.setLineDash([]);
                        context.moveTo(fx1, fy1);
                        context.lineTo(fx2, fy2);
                        context.stroke();
                    });

                    context.strokeStyle = toRgba(color, 0.6);
                    context.lineWidth = 1;
                    context.setLineDash([4, 2]);
                    context.beginPath();
                    context.moveTo(p0.x, p0.y);
                    context.lineTo(p2.x, p2.y);
                    context.stroke();
                    context.setLineDash([]);
                }
            });

            context.restore();
        });
    }
}

class DrawingPaneView {
    constructor(source) {
        this._renderer = new DrawingPaneRenderer(source);
    }

    renderer() {
        return this._renderer;
    }
}

export class DrawingPrimitive {
    constructor() {
        this._drawings = [];
        this._paneViews = [new DrawingPaneView(this)];
        this._requestUpdate = null;
    }

    attached(param) {
        this._requestUpdate = param.requestUpdate;
    }

    detached() {
        this._requestUpdate = null;
    }

    drawings() {
        return this._drawings;
    }

    setDrawings(drawings) {
        this._drawings = drawings || [];
        if (this._requestUpdate) this._requestUpdate();
    }

    paneViews() {
        return this._paneViews;
    }
}
