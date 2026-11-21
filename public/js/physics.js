// Verlet-integration Line Rider physics engine:
// - 4-point rigid sled/skis + 4-point rider + 6-node flowing scarf
// - Breakable mount constraints -> hilarious ragdoll bail on head-hits or flips
// - Spatial hash grid for fast collision with stock + user-drawn segments
// - Supports both "classic" (pure gravity) and "controls" (tuck, jump, lean, boost)

const CELL_SIZE = 90;

export class SpatialGrid {
  constructor() {
    this.cells = new Map();
    this.segments = [];
  }

  clear() {
    this.cells.clear();
    this.segments = [];
  }

  addSegments(segs) {
    for (const seg of segs) {
      if (seg.type === 'scenery') continue;
      const dx = seg.bx - seg.ax;
      const dy = seg.by - seg.ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;

      const tx = dx / len;
      const ty = dy / len;
      // Upward normal for left-to-right segments
      const nx = ty;
      const ny = -tx;

      const compiled = {
        ...seg,
        dx,
        dy,
        len,
        lenSq: len * len,
        tx,
        ty,
        nx,
        ny,
      };
      const idx = this.segments.length;
      this.segments.push(compiled);

      const minCX = Math.floor((Math.min(seg.ax, seg.bx) - 24) / CELL_SIZE);
      const maxCX = Math.floor((Math.max(seg.ax, seg.bx) + 24) / CELL_SIZE);
      const minCY = Math.floor((Math.min(seg.ay, seg.by) - 24) / CELL_SIZE);
      const maxCY = Math.floor((Math.max(seg.ay, seg.by) + 24) / CELL_SIZE);

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const key = `${cx},${cy}`;
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(idx);
        }
      }
    }
  }

  queryPoint(x, y, outSet) {
    outSet.clear();
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = this.cells.get(`${cx + ox},${cy + oy}`);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          outSet.add(bucket[i]);
        }
      }
    }
    return outSet;
  }
}

function makePoint(x, y, vx = 0, vy = 0, radius = 3.5, isRider = false, isHead = false) {
  return {
    x,
    y,
    ox: x - vx,
    oy: y - vy,
    radius,
    isRider,
    isHead,
    grounded: false,
    groundNx: 0,
    groundNy: -1,
  };
}

function makeConstraint(a, b, restLen = null, breakable = false, maxStretch = 1.65) {
  const len = restLen ?? Math.hypot(b.x - a.x, b.y - a.y);
  return { a, b, len, baseLen: len, breakable, maxStretch, broken: false };
}

export class RiderSimulation {
  constructor() {
    this.points = [];
    this.constraints = [];
    this.scarf = [];
    this.sparks = [];
    this.mounted = true;
    this.bailedAt = 0;
    this.upsideDownFrames = 0;
    this.time = 0;
    this.airTime = 0;
    this.bestAirTime = 0;
    this.coyoteTimer = 0;
    this.jumpCooldown = 0;
    this.boosting = false;
    this.tucking = false;
    this.finished = false;
    this.maxXReached = 0;
    this.speed = 0;
    this._querySet = new Set();
  }

  reset(spawnX, spawnY, initialVx = 2.2) {
    this.mounted = true;
    this.bailedAt = 0;
    this.upsideDownFrames = 0;
    this.time = 0;
    this.airTime = 0;
    this.bestAirTime = 0;
    this.coyoteTimer = 0;
    this.jumpCooldown = 0;
    this.boosting = false;
    this.tucking = false;
    this.finished = false;
    this.maxXReached = spawnX;
    this.speed = initialVx;
    this.sparks = [];

    // Sled / Skis rigid frame (4 points)
    const tail = makePoint(spawnX - 18, spawnY + 6, initialVx, 0, 4.0);
    const nose = makePoint(spawnX + 18, spawnY + 6, initialVx, 0, 4.0);
    const backTop = makePoint(spawnX - 14, spawnY - 5, initialVx, 0, 3.5);
    const frontTop = makePoint(spawnX + 14, spawnY - 5, initialVx, 0, 3.5);

    // Rider body (4 points)
    const butt = makePoint(spawnX - 3, spawnY - 7, initialVx, 0, 3.5, true);
    const shoulder = makePoint(spawnX + 2, spawnY - 21, initialVx, 0, 3.5, true);
    const hand = makePoint(spawnX + 12, spawnY - 15, initialVx, 0, 3.0, true);
    const head = makePoint(spawnX + 4, spawnY - 30, initialVx, 0, 5.5, true, true);

    this.points = [tail, nose, backTop, frontTop, butt, shoulder, hand, head];
    this.p = { tail, nose, backTop, frontTop, butt, shoulder, hand, head };

    this.constraints = [
      // Sled rigid box (all 6 edges)
      makeConstraint(tail, nose),
      makeConstraint(backTop, frontTop),
      makeConstraint(tail, backTop),
      makeConstraint(nose, frontTop),
      makeConstraint(tail, frontTop),
      makeConstraint(nose, backTop),

      // Rider skeleton (stays intact even after bailing)
      makeConstraint(butt, shoulder),
      makeConstraint(shoulder, head),
      makeConstraint(shoulder, hand),
      makeConstraint(butt, hand),
      makeConstraint(butt, head),

      // Mount constraints (breakable on crash!)
      makeConstraint(butt, tail, null, true, 1.55),
      makeConstraint(butt, nose, null, true, 1.55),
      makeConstraint(butt, backTop, null, true, 1.55),
      makeConstraint(butt, frontTop, null, true, 1.55),
      makeConstraint(shoulder, backTop, null, true, 1.6),
      makeConstraint(shoulder, frontTop, null, true, 1.6),
      makeConstraint(hand, frontTop, null, true, 1.75),
    ];

    // Flowing 7-node scarf attached to shoulder
    this.scarf = [];
    for (let i = 0; i < 7; i++) {
      this.scarf.push({
        x: shoulder.x - i * 4.5,
        y: shoulder.y - i * 0.5,
        ox: shoulder.x - i * 4.5 - initialVx,
        oy: shoulder.y - i * 0.5,
      });
    }
  }

  bail() {
    if (!this.mounted) return;
    this.mounted = false;
    this.bailedAt = this.time;
    for (const c of this.constraints) {
      if (c.breakable) c.broken = true;
    }
    // Give the rider a tiny upward pop so the ragdoll tumble looks dramatic
    const { butt, shoulder, head, hand } = this.p;
    for (const pt of [butt, shoulder, head, hand]) {
      pt.oy += 0.9;
    }
  }

  getCenter() {
    if (this.mounted) {
      const { tail, nose, shoulder } = this.p;
      return {
        x: (tail.x + nose.x + shoulder.x) / 3,
        y: (tail.y + nose.y + shoulder.y) / 3,
      };
    }
    return { x: this.p.shoulder.x, y: this.p.shoulder.y };
  }

  getVelocity() {
    const ref = this.mounted ? this.p.nose : this.p.shoulder;
    return { vx: ref.x - ref.ox, vy: ref.y - ref.oy };
  }

  step(grid, mode, input, trackMaxX) {
    const SUBSTEPS = 6;
    const dt = 1 / SUBSTEPS;
    const GRAVITY = 0.17 * dt * dt;

    this.time += 1 / 60;
    if (this.jumpCooldown > 0) this.jumpCooldown -= 1 / 60;

    const controlsOn = mode === 'controls' && this.mounted;
    this.tucking = Boolean(controlsOn && input.down);
    this.boosting = Boolean(controlsOn && input.boost);

    // Adjust tuck posture smoothly by shortening/lengthening upper mount constraints
    for (const c of this.constraints) {
      if (c.breakable && !c.broken && (c.a === this.p.shoulder || c.b === this.p.shoulder)) {
        const target = this.tucking ? c.baseLen * 0.78 : c.baseLen;
        c.len += (target - c.len) * 0.22;
      }
    }

    let anySledGrounded = false;
    let avgNx = 0;
    let avgNy = 0;
    let groundCount = 0;

    for (let sub = 0; sub < SUBSTEPS; sub++) {
      // 1. Verlet integration
      const drag = this.tucking ? 0.9996 : 0.9988;
      for (const pt of this.points) {
        const vx = (pt.x - pt.ox) * drag;
        const vy = (pt.y - pt.oy) * drag;
        pt.ox = pt.x;
        pt.oy = pt.y;
        pt.x += vx;
        pt.y += vy + GRAVITY;
        pt.grounded = false;
      }

      // 2. Controls forces (when Controls mode is enabled and rider is mounted)
      if (controlsOn) {
        const { tail, nose, backTop, frontTop, shoulder, head } = this.p;
        const sdx = nose.x - tail.x;
        const sdy = nose.y - tail.y;
        const slen = Math.hypot(sdx, sdy) || 1;
        const fx = sdx / slen; // sled forward unit vector
        const fy = sdy / slen;

        // Turbo boost along sled forward direction
        if (input.boost) {
          const boostAcc = 0.28 * dt * dt;
          for (const pt of this.points) {
            pt.x += fx * boostAcc;
            pt.y += fy * boostAcc;
          }
        }

        // Tuck extra downhill carve
        if (input.down && this.coyoteTimer > 0) {
          const tuckAcc = 0.08 * dt * dt;
          for (const pt of [tail, nose, backTop, frontTop]) {
            pt.x += fx * tuckAcc;
            pt.y += fy * tuckAcc;
          }
        }

        // Lean / pump (Left / Right)
        const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (steer !== 0) {
          if (this.coyoteTimer > 0) {
            // Pump / push forward or brake on ground
            const pumpAcc = steer * 0.14 * dt * dt;
            for (const pt of this.points) {
              pt.x += fx * pumpAcc;
              pt.y += fy * pumpAcc;
            }
          } else {
            // Midair rotation (backflip / frontflip / landing alignment)
            const torque = steer * 0.13 * dt * dt;
            // Rotate sled + rider around center
            const cx = (tail.x + nose.x) * 0.5;
            const cy = (tail.y + nose.y) * 0.5;
            for (const pt of [tail, nose, shoulder, head]) {
              const rx = pt.x - cx;
              const ry = pt.y - cy;
              pt.x += -ry * torque * 0.05;
              pt.y += rx * torque * 0.05;
            }
          }
        }
      }

      // 3. Constraint relaxation
      for (let iter = 0; iter < 6; iter++) {
        for (const c of this.constraints) {
          if (c.broken) continue;
          const dx = c.b.x - c.a.x;
          const dy = c.b.y - c.a.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const diff = (dist - c.len) / dist;
          const mx = dx * 0.5 * diff;
          const my = dy * 0.5 * diff;
          c.a.x += mx;
          c.a.y += my;
          c.b.x -= mx;
          c.b.y -= my;
        }
      }

      // 4. Collision with track segments
      for (const pt of this.points) {
        const candidates = grid.queryPoint(pt.x, pt.y, this._querySet);
        for (const segIdx of candidates) {
          const seg = grid.segments[segIdx];
          this._collidePointSegment(pt, seg, dt);
        }
        if (pt.grounded && !pt.isRider) {
          anySledGrounded = true;
          avgNx += pt.groundNx;
          avgNy += pt.groundNy;
          groundCount++;
        }
      }
    }

    // Check jump (with coyote time for responsive feel)
    if (anySledGrounded) {
      this.coyoteTimer = 0.14;
      if (this.airTime > this.bestAirTime) this.bestAirTime = this.airTime;
      this.airTime = 0;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - 1 / 60);
      this.airTime += 1 / 60;
    }

    if (controlsOn && input.jump && this.coyoteTimer > 0 && this.jumpCooldown <= 0) {
      const nx = groundCount > 0 ? avgNx / groundCount : 0;
      const ny = groundCount > 0 ? avgNy / groundCount : -1;
      const jumpImp = 1.35; // per substep velocity units
      for (const pt of this.points) {
        pt.oy -= (ny * 0.85 - 0.15) * jumpImp;
        pt.ox -= nx * 0.35 * jumpImp;
      }
      this.coyoteTimer = 0;
      this.jumpCooldown = 0.28;
    }

    // Check upside-down crash on sled (require sustained inversion, not momentary spike bumps)
    if (this.mounted && anySledGrounded) {
      const { tail, backTop } = this.p;
      const upY = backTop.y - tail.y; // normally ~ -11 (backTop is above tail)
      if (upY > 7.5) {
        this.upsideDownFrames++;
        if (this.upsideDownFrames >= 8) {
          this.bail();
        }
      } else {
        this.upsideDownFrames = Math.max(0, this.upsideDownFrames - 2);
      }
    } else {
      this.upsideDownFrames = 0;
    }

    // Update scarf Verlet chain
    this._updateScarf();

    // Update boost / snow sparks
    const vel = this.getVelocity();
    const speedSubstep = Math.hypot(vel.vx, vel.vy);
    this.speed = speedSubstep * 6; // pixels per frame

    if (this.boosting && this.mounted) {
      const { tail } = this.p;
      for (let i = 0; i < 2; i++) {
        this.sparks.push({
          x: tail.x + (Math.random() - 0.5) * 4,
          y: tail.y + (Math.random() - 0.5) * 4,
          vx: -vel.vx * 2.5 + (Math.random() - 0.5) * 2.5,
          vy: -vel.vy * 2.5 + (Math.random() - 0.5) * 2.5,
          life: 1,
          color: Math.random() > 0.4 ? '#f97316' : '#facc15',
        });
      }
    } else if (anySledGrounded && this.speed > 5.5 && Math.random() < 0.45) {
      const { tail } = this.p;
      this.sparks.push({
        x: tail.x,
        y: tail.y + 2,
        vx: -vel.vx * 1.2 + (Math.random() - 0.5) * 1.6,
        vy: -Math.random() * 1.8 - 0.5,
        life: 0.75,
        color: '#94a3b8',
      });
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vy += 0.08;
      sp.life -= 0.045;
      if (sp.life <= 0) this.sparks.splice(i, 1);
    }

    const center = this.getCenter();
    if (center.x > this.maxXReached) this.maxXReached = center.x;
    if (trackMaxX && center.x >= trackMaxX - 10) {
      this.finished = true;
    }
  }

  _collidePointSegment(pt, seg, dt) {
    const px = pt.x - seg.ax;
    const py = pt.y - seg.ay;
    const proj = px * seg.tx + py * seg.ty;
    if (proj < -pt.radius || proj > seg.len + pt.radius) return;

    const clamped = Math.max(0, Math.min(seg.len, proj));
    const closestX = seg.ax + seg.tx * clamped;
    const closestY = seg.ay + seg.ty * clamped;

    const rx = pt.x - closestX;
    const ry = pt.y - closestY;

    if (seg.type === 'stock' || seg.type === 'ramp') {
      // One-sided top surface collision with deep anti-tunneling catch band
      const signedDist = rx * seg.nx + ry * seg.ny;
      const CATCH_DEPTH = -22;
      if (signedDist < pt.radius && signedDist > CATCH_DEPTH) {
        const vx = pt.x - pt.ox;
        const vy = pt.y - pt.oy;
        const vn = vx * seg.nx + vy * seg.ny;

        // Only push out if moving into or resting on surface
        if (vn <= 0.15) {
          const push = pt.radius - signedDist;
          pt.x += seg.nx * push;
          pt.y += seg.ny * push;

          // Head hitting the track hard causes a bail (forgiving on light grazes)
          if (pt.isHead && this.mounted && -vn > 1.35) {
            this.bail();
          }

          // Friction (low for smooth ski glide, but settles cleanly when nearly stopped)
          const vt = vx * seg.tx + vy * seg.ty;
          const isNearlyStopped = Math.abs(vt) < 0.06;
          const friction = isNearlyStopped
            ? 0.25
            : pt.isRider && !this.mounted
              ? 0.08
              : 0.0025;
          pt.ox = pt.x - (vt * (1 - friction)) * seg.tx;
          pt.oy = pt.y - (vt * (1 - friction)) * seg.ty;

          pt.grounded = true;
          pt.groundNx = seg.nx;
          pt.groundNy = seg.ny;
        }
      }
    } else {
      // User-drawn ink / boost lines: two-sided capsule collision so drawing in either direction works
      const distSq = rx * rx + ry * ry;
      const minDist = pt.radius + 2.5;
      if (distSq < minDist * minDist && distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        let nx = rx / dist;
        let ny = ry / dist;

        // Keep normal consistent with previous frame side
        const prevDot = (pt.ox - closestX) * nx + (pt.oy - closestY) * ny;
        if (prevDot < -1.5) {
          nx = -nx;
          ny = -ny;
        }

        const push = minDist - dist;
        pt.x += nx * push;
        pt.y += ny * push;

        const vx = pt.x - pt.ox;
        const vy = pt.y - pt.oy;
        const vn = vx * nx + vy * ny;

        if (pt.isHead && this.mounted && -vn > 1.45) {
          this.bail();
        }

        if (vn < 0) {
          const vt = vx * seg.tx + vy * seg.ty;
          let newVt = vt * (pt.isRider && !this.mounted ? 0.94 : 0.997);
          // Red boost line accelerates along drawn tangent!
          if (seg.type === 'boost') {
            newVt += 0.18 * dt;
          }
          pt.ox = pt.x - newVt * seg.tx;
          pt.oy = pt.y - newVt * seg.ty;
        } else if (seg.type === 'boost') {
          pt.x += seg.tx * 0.12 * dt;
          pt.y += seg.ty * 0.12 * dt;
        }

        pt.grounded = true;
        pt.groundNx = nx;
        pt.groundNy = ny;
      }
    }
  }

  _updateScarf() {
    if (!this.scarf.length) return;
    const anchor = this.p.shoulder;
    this.scarf[0].x = anchor.x;
    this.scarf[0].y = anchor.y;

    for (let i = 1; i < this.scarf.length; i++) {
      const node = this.scarf[i];
      const vx = (node.x - node.ox) * 0.92;
      const vy = (node.y - node.oy) * 0.92;
      node.ox = node.x;
      node.oy = node.y;
      node.x += vx - 0.12; // subtle trailing breeze
      node.y += vy + 0.08;
    }

    const segLen = 5.0;
    for (let iter = 0; iter < 4; iter++) {
      this.scarf[0].x = anchor.x;
      this.scarf[0].y = anchor.y;
      for (let i = 0; i < this.scarf.length - 1; i++) {
        const a = this.scarf[i];
        const b = this.scarf[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const diff = (dist - segLen) / dist;
        if (i === 0) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * 0.5 * diff;
          a.y += dy * 0.5 * diff;
          b.x -= dx * 0.5 * diff;
          b.y -= dy * 0.5 * diff;
        }
      }
    }
  }
}
