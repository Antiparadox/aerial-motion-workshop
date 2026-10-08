// Native mesh and painter from visualization/realtime.html, isolated from deck canvases.
(() => {
const testbedCanvas=document.getElementById('testbed-model');
let canvas=testbedCanvas, ctx=canvas.getContext('2d');
const LIVE_CAMERA_FOV_DEG=35;
function cameraSettingNumber(id,fallback){return fallback}
let snapshot=null;
    function bodyToWorld(p, R, body, scale) {
      return [
        p[0] + scale * (R[0][0] * body[0] + R[0][1] * body[1] + R[0][2] * body[2]),
        p[1] + scale * (R[1][0] * body[0] + R[1][1] * body[1] + R[1][2] * body[2]),
        p[2] + scale * (R[2][0] * body[0] + R[2][1] * body[1] + R[2][2] * body[2]),
      ];
    }

    function easedCameraSpan(altitude) {
      const minimum = 12;
      const expanded = Math.abs(altitude) * 1.6 + 5;
      const transitionWidth = 5;
      const excess = expanded - minimum;
      if (excess <= 0) return minimum;
      if (excess >= transitionWidth) return expanded;
      const x = excess / transitionWidth;
      const smoothstep = x * x * (3 - 2 * x);
      return minimum + excess * smoothstep;
    }

    function vectorSubtract(a, b) {
      return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    function vectorDot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    function vectorCross(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    }

    function vectorUnit(value, fallback) {
      const norm = Math.hypot(value[0], value[1], value[2]);
      return norm > 1e-9
        ? value.map(component => component / norm)
        : fallback.slice();
    }

    function effectivePerspectiveFov(position, zoomTarget, mode) {
      const baseFov = cameraSettingNumber("cameraFov", LIVE_CAMERA_FOV_DEG);
      const zoomMode = "logarithmic";
      if (mode !== "pilot" || zoomMode === "off") return baseFov;

      const referenceDistance = Math.hypot(
        FIXED_CAMERA_TARGET_NED[0] - PILOT_CAMERA_POSITION_NED[0],
        FIXED_CAMERA_TARGET_NED[1] - PILOT_CAMERA_POSITION_NED[1],
        FIXED_CAMERA_TARGET_NED[2] - PILOT_CAMERA_POSITION_NED[2],
      );
      const actualDistance = Math.hypot(...vectorSubtract(zoomTarget, position));
      const maxDistance = cameraSettingNumber("cameraMaxDistance", 250);
      const distance = Math.max(2, Math.min(actualDistance, maxDistance));
      const strength = cameraSettingNumber("cameraZoomStrength", 50) / 100;
      const ratio = referenceDistance / distance;
      const scale = zoomMode === "logarithmic"
        ? Math.pow(ratio, strength)
        : 1 + strength * (ratio - 1);
      const baseTangent = Math.tan(baseFov * Math.PI / 360);
      const effective = 2 * Math.atan(Math.max(0.05, baseTangent * scale)) * 180 / Math.PI;
      return Math.max(12, Math.min(80, effective));
    }

    function perspectiveCamera(position, target, mode, zoomTarget = target) {
      const forward = vectorUnit(vectorSubtract(target, position), [1, 0, 0]);
      const nedUp = [0, 0, -1];
      const right = vectorUnit(vectorCross(forward, nedUp), [0, 1, 0]);
      const up = vectorUnit(vectorCross(right, forward), nedUp);
      return {
        projection: "perspective",
        mode,
        position: position.slice(),
        target: target.slice(),
        forward,
        right,
        up,
        fovDeg: effectivePerspectiveFov(position, zoomTarget, mode),
        near: 0.20,
        n: target[0],
        e: target[1],
        alt: -target[2],
        span: 25,
      };
    }

    function resetLiveCamera() {
      cameraState.initialized = false;
      cameraState.target = FIXED_CAMERA_TARGET_NED.slice();
      cameraState.lastFrameTime = performance.now();
    }

    function resetReplayCamera(state) {
      state.initialized = false;
      state.target = FIXED_CAMERA_TARGET_NED.slice();
      state.lastFrameTime = performance.now();
    }

    function pilotTrackingCamera(positions, state, elapsed) {
      const visiblePositions = positions.length > 0
        ? positions
        : [FIXED_CAMERA_TARGET_NED];
      const desiredTarget = [0, 1, 2].map(axis => (
        visiblePositions.reduce((sum, position) => sum + position[axis], 0)
        / visiblePositions.length
      ));
      if (true) {
        // Use the same ground-aware vertical framing as the live simulator.
        // With two comparison layers, their mean position becomes the pilot's
        // visual target so neither trajectory owns the camera.
        desiredTarget[2] += (groundPlaneDown() - desiredTarget[2]) * 0.38;
      }
      if (!state.initialized) {
        state.target = desiredTarget;
        state.initialized = true;
      } else {
        const damping = cameraSettingNumber("cameraDamping", 1);
        const lookBlend = damping <= 0
          ? 1
          : 1 - Math.exp(-elapsed / (0.18 * damping));
        for (let index = 0; index < 3; index++) {
          state.target[index] += (
            desiredTarget[index] - state.target[index]
          ) * lookBlend;
        }
      }
      const zoomTarget = visiblePositions.reduce((furthest, position) => (
        Math.hypot(...vectorSubtract(position, PILOT_CAMERA_POSITION_NED))
          > Math.hypot(...vectorSubtract(furthest, PILOT_CAMERA_POSITION_NED))
          ? position
          : furthest
      ), visiblePositions[0]);
      return perspectiveCamera(
        PILOT_CAMERA_POSITION_NED, state.target, "pilot", zoomTarget,
      );
    }

    function replayCamera(fixedCamera, mode, positions, state) {
      if (mode !== "pilot") return fixedCamera;
      const now = performance.now();
      const elapsed = Math.min(
        0.05, Math.max(0, (now - state.lastFrameTime) / 1000),
      );
      state.lastFrameTime = now;
      return pilotTrackingCamera(positions, state, elapsed);
    }

    function camera() {
      if (!snapshot) {
        return perspectiveCamera(
          PILOT_CAMERA_POSITION_NED, FIXED_CAMERA_TARGET_NED, "pilot",
        );
      }
      const now = performance.now();
      const elapsed = Math.min(0.05, Math.max(0, (now - cameraState.lastFrameTime) / 1000));
      cameraState.lastFrameTime = now;

      const p = snapshot.state.position_world;
      if (cameraState.mode === "pilot") {
        return pilotTrackingCamera([p], cameraState, elapsed);
      }
      if (cameraState.mode === "fixed") {
        cameraState.initialized = true;
        return perspectiveCamera(
          PILOT_CAMERA_POSITION_NED, FIXED_CAMERA_TARGET_NED, "fixed",
        );
      }

      // Legacy orthographic chase view retained solely as a debugging mode.
      const altitude = -p[2];
      const target = {
        n: p[0],
        e: p[1],
        alt: altitude / 2,
        span: easedCameraSpan(altitude),
      };
      if (!cameraState.initialized) {
        Object.assign(cameraState, target, {initialized: true});
      } else {
        const positionBlend = 1 - Math.exp(-elapsed / 0.24);
        const zoomBlend = 1 - Math.exp(-elapsed / 0.65);
        cameraState.n += (target.n - cameraState.n) * positionBlend;
        cameraState.e += (target.e - cameraState.e) * positionBlend;
        cameraState.alt += (target.alt - cameraState.alt) * positionBlend;
        cameraState.span += (target.span - cameraState.span) * zoomBlend;
      }
      return cameraState;
    }

    function project(point, cam) {
      if (cam.projection === "perspective") {
        const relative = vectorSubtract(point, cam.position);
        const depth = vectorDot(relative, cam.forward);
        if (depth <= cam.near) return null;
        const x = vectorDot(relative, cam.right);
        const y = vectorDot(relative, cam.up);
        const focal = (canvas.clientWidth * 0.5)
          / Math.tan((cam.fovDeg * Math.PI / 180) * 0.5);
        return [
          canvas.clientWidth * 0.50 + focal * x / depth,
          canvas.clientHeight * 0.50 - focal * y / depth,
        ];
      }
      const n = point[0] - cam.n;
      const e = point[1] - cam.e;
      const alt = -point[2] - cam.alt;
      const scale = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.62 / cam.span;
      return [
        canvas.clientWidth * 0.50 + scale * (0.86 * e + 0.50 * n),
        canvas.clientHeight * 0.54 - scale * (alt + 0.30 * n),
      ];
    }

    // Positive depth points away from the camera. Canvas has no z-buffer, so
    // the complete helicopter is collected and painted from far to near.
    const orthographicCameraDepthDirection = [0.86, -0.50, 0.258];
    let activeCameraDepthDirection = orthographicCameraDepthDirection;
    let helicopterRenderQueue = null;

    function cameraDepth(point) {
      return point[0] * activeCameraDepthDirection[0]
        + point[1] * activeCameraDepthDirection[1]
        + point[2] * activeCameraDepthDirection[2];
    }

    function meanCameraDepth(points) {
      return points.reduce((sum, point) => sum + cameraDepth(point), 0) / points.length;
    }

    function enqueueHelicopterPrimitive(worldPoints, paint) {
      if (helicopterRenderQueue === null) {
        paint();
        return;
      }
      helicopterRenderQueue.push({depth: meanCameraDepth(worldPoints), paint});
    }

    function beginHelicopterRenderQueue() {
      helicopterRenderQueue = [];
    }

    function flushHelicopterRenderQueue() {
      const queue = helicopterRenderQueue || [];
      helicopterRenderQueue = null;
      queue.sort((a, b) => b.depth - a.depth);
      for (const primitive of queue) primitive.paint();
    }

    function drawLine3d(
      p, R, a, b, modelScale, color, width, cam, alpha = 1, dashed = false,
    ) {
      const wa = bodyToWorld(p, R, a, modelScale);
      const wb = bodyToWorld(p, R, b, modelScale);
      const pa = project(wa, cam);
      const pb = project(wb, cam);
      if (!pa || !pb) return;
      enqueueHelicopterPrimitive([wa, wb], () => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        if (dashed) ctx.setLineDash([7, 5]);
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
        ctx.restore();
      });
    }

    function drawPolygon3d(p, R, points, modelScale, fill, stroke, cam) {
      const world = points.map(point => bodyToWorld(p, R, point, modelScale));
      const projected = world.map(point => project(point, cam));
      if (projected.some(point => point === null)) return;
      enqueueHelicopterPrimitive(world, () => {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(projected[0][0], projected[0][1]);
        for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i][0], projected[i][1]);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
        ctx.fill(); ctx.stroke();
        ctx.restore();
      });
    }

    function drawMesh3d(p, R, vertices, faces, modelScale, cam) {
      const world = vertices.map(vertex => bodyToWorld(p, R, vertex, modelScale));
      const projected = world.map(point => project(point, cam));
      for (const face of faces) {
        const faceWorld = face.indices.map(index => world[index]);
        const points = face.indices.map(index => projected[index]);
        if (points.some(point => point === null)) continue;
        enqueueHelicopterPrimitive(faceWorld, () => {
          ctx.save();
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(points[0][0], points[0][1]);
          for (let index = 1; index < points.length; index++) {
            ctx.lineTo(points[index][0], points[index][1]);
          }
          ctx.closePath();
          ctx.fillStyle = face.fill;
          ctx.strokeStyle = face.stroke || "rgba(15, 23, 42, 0.92)";
          ctx.lineWidth = face.width || 1.5;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        });
      }
    }

    function drawMarker3d(p, R, point, modelScale, radius, fill, stroke, cam, glow = 0) {
      const world = bodyToWorld(p, R, point, modelScale);
      const projected = project(world, cam);
      if (!projected) return;
      enqueueHelicopterPrimitive([world], () => {
        ctx.save();
        if (glow > 0) {
          ctx.shadowColor = fill;
          ctx.shadowBlur = glow;
        }
        ctx.beginPath();
        ctx.arc(projected[0], projected[1], radius, 0, 2 * Math.PI);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      });
    }

    function drawLabel3d(p, R, point, modelScale, text, color, cam) {
      const projected = project(bodyToWorld(p, R, point, modelScale), cam);
      if (!projected) return;
      ctx.save();
      ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(11, 17, 32, 0.92)";
      ctx.strokeText(text, projected[0], projected[1]);
      ctx.fillStyle = color;
      ctx.fillText(text, projected[0], projected[1]);
      ctx.restore();
    }

    const canopyMesh = {
      vertices: [
        [0.84, 0.00, -0.02], [0.49, -0.21, -0.22], [0.49, 0.21, -0.22],
        [-0.32, -0.25, -0.18], [-0.32, 0.25, -0.18], [0.50, -0.23, 0.17],
        [0.50, 0.23, 0.17], [-0.43, -0.19, 0.21], [-0.43, 0.19, 0.21],
        [0.02, 0.00, 0.31], [0.06, 0.00, -0.30], [-0.52, 0.00, 0.01],
      ],
      faces: [
        {indices: [0, 1, 10], fill: "#fb923c"},
        {indices: [0, 10, 2], fill: "#fdba74"},
        {indices: [1, 3, 10], fill: "#ea580c"},
        {indices: [10, 4, 2], fill: "#f97316"},
        {indices: [1, 5, 7, 3], fill: "#c2410c"},
        {indices: [2, 4, 8, 6], fill: "#f97316"},
        {indices: [0, 5, 1], fill: "#f97316"},
        {indices: [0, 2, 6], fill: "#fdba74"},
        {indices: [0, 6, 9, 5], fill: "#ea580c"},
        {indices: [5, 9, 7], fill: "#7c2d12"},
        {indices: [6, 8, 9], fill: "#c2410c"},
        {indices: [3, 7, 11], fill: "#431407"},
        {indices: [4, 11, 8], fill: "#7c2d12"},
        {indices: [3, 11, 4, 10], fill: "#9a3412"},
        {indices: [7, 9, 8, 11], fill: "#292524"},
      ],
    };

    const tailBoomMesh = {
      vertices: [
        [-0.35, -0.09, -0.06], [-0.35, 0.09, -0.06], [-0.35, -0.09, 0.07], [-0.35, 0.09, 0.07],
        [-1.52, -0.035, -0.035], [-1.52, 0.035, -0.035], [-1.52, -0.035, 0.035], [-1.52, 0.035, 0.035],
      ],
      faces: [
        {indices: [0, 4, 5, 1], fill: "#334155", stroke: "#64748b"},
        {indices: [2, 3, 7, 6], fill: "#0f172a", stroke: "#475569"},
        {indices: [0, 2, 6, 4], fill: "#111827", stroke: "#475569"},
        {indices: [1, 5, 7, 3], fill: "#1e293b", stroke: "#64748b"},
        {indices: [4, 6, 7, 5], fill: "#020617", stroke: "#94a3b8"},
      ],
    };

    function rotorBladePolygon(cosine, sine, direction, innerRadius, outerRadius, innerWidth, tipWidth, z) {
      const dx = direction * cosine;
      const dy = direction * sine;
      const px = -sine;
      const py = cosine;
      return [
        [dx * innerRadius + px * innerWidth, dy * innerRadius + py * innerWidth, z],
        [dx * outerRadius + px * tipWidth, dy * outerRadius + py * tipWidth, z],
        [dx * outerRadius - px * tipWidth, dy * outerRadius - py * tipWidth, z],
        [dx * innerRadius - px * innerWidth, dy * innerRadius - py * innerWidth, z],
      ];
    }

    function tailBladePolygon(cosine, sine, direction) {
      const dy = direction * cosine;
      const dz = direction * sine;
      const py = -sine;
      const pz = cosine;
      return [
        [-1.57, dy * 0.07 + py * 0.026, dz * 0.07 + pz * 0.026],
        [-1.57, dy * 0.33 + py * 0.018, dz * 0.33 + pz * 0.018],
        [-1.57, dy * 0.33 - py * 0.018, dz * 0.33 - pz * 0.018],
        [-1.57, dy * 0.07 - py * 0.026, dz * 0.07 - pz * 0.026],
      ];
    }

    function drawHelicopter(
      p, R, cam, showDebugCues = true, animationTime = null,
      modelScaleOverride = null,
    ) {
      // A detailed low-poly 700-class aerobatic model. Its physical dimensions
      // scale with the live camera unless comparison mode supplies a fixed
      // metres-per-model-unit scale for geometrically faithful replay.
      const modelScale = modelScaleOverride ?? cam.span * 0.18;
      const rotorPhase = (animationTime === null ? (snapshot?.t || 0) : animationTime) * 25;
      const c = Math.cos(rotorPhase), s = Math.sin(rotorPhase);

      // The halo is a screen-space backdrop, not part of the 3D model.
      drawMarker3d(p, R, [0, 0, 0.03], modelScale, 25, "rgba(33, 59, 80, 0.07)", "rgba(33, 59, 80, 0.05)", cam);
      beginHelicopterRenderQueue();

      // Carbon frames, motor can, and battery tray remain visible behind the canopy.
      drawPolygon3d(p, R, [[-0.38, -0.16, -0.12], [0.12, -0.18, -0.17], [0.25, -0.17, 0.22], [-0.38, -0.15, 0.20]], modelScale, "#111827", "#94a3b8", cam);
      drawPolygon3d(p, R, [[-0.38, 0.16, -0.12], [0.12, 0.18, -0.17], [0.25, 0.17, 0.22], [-0.38, 0.15, 0.20]], modelScale, "#1f2937", "#64748b", cam);
      drawLine3d(p, R, [-0.28, -0.17, -0.08], [0.18, -0.17, 0.19], modelScale, "#475569", 4, cam);
      drawLine3d(p, R, [-0.28, 0.17, -0.08], [0.18, 0.17, 0.19], modelScale, "#64748b", 4, cam);
      drawPolygon3d(p, R, [[-0.16, -0.12, -0.20], [0.12, -0.12, -0.20], [0.12, 0.12, -0.20], [-0.16, 0.12, -0.20]], modelScale, "#334155", "#cbd5e1", cam);

      // Tapered carbon boom, swept stabilizer, vertical fin, and tail gearbox.
      drawMesh3d(p, R, tailBoomMesh.vertices, tailBoomMesh.faces, modelScale, cam);
      drawPolygon3d(p, R, [[-1.14, -0.42, 0.01], [-1.35, -0.30, 0.01], [-1.35, 0.30, 0.01], [-1.14, 0.42, 0.01]], modelScale, "#e2e8f0", "#0f172a", cam);
      drawPolygon3d(p, R, [[-1.22, -0.34, 0.005], [-1.34, -0.27, 0.005], [-1.34, 0.27, 0.005], [-1.22, 0.34, 0.005]], modelScale, "#f97316", "#7c2d12", cam);
      drawPolygon3d(p, R, [[-1.41, 0, 0.04], [-1.52, 0, -0.46], [-1.72, 0, -0.25], [-1.65, 0, 0.22], [-1.51, 0, 0.12]], modelScale, "#111827", "#cbd5e1", cam);
      drawPolygon3d(p, R, [[-1.50, -0.002, -0.40], [-1.69, -0.002, -0.24], [-1.65, -0.002, -0.08]], modelScale, "#f97316", "#ffedd5", cam);
      drawMarker3d(p, R, [-1.55, -0.035, 0], modelScale, 7, "#0f172a", "#cbd5e1", cam);

      // Low, wide landing gear with raised toes, typical of competition 3D machines.
      for (const y of [-0.27, 0.27]) {
        drawLine3d(p, R, [-0.52, y, 0.41], [0.56, y, 0.41], modelScale, "#e2e8f0", 5, cam);
        drawLine3d(p, R, [0.56, y, 0.41], [0.68, y, 0.34], modelScale, "#f8fafc", 5, cam);
        drawLine3d(p, R, [-0.31, y, 0.41], [-0.20, y * 0.55, 0.16], modelScale, "#94a3b8", 3, cam);
        drawLine3d(p, R, [0.32, y, 0.41], [0.19, y * 0.55, 0.17], modelScale, "#94a3b8", 3, cam);
      }
      drawLine3d(p, R, [-0.31, -0.27, 0.41], [-0.31, 0.27, 0.41], modelScale, "#64748b", 3, cam);
      drawLine3d(p, R, [0.32, -0.27, 0.41], [0.32, 0.27, 0.41], modelScale, "#64748b", 3, cam);

      // Faceted aerodynamic canopy with asymmetric shading, smoked windshield,
      // and high-visibility competition graphics.
      drawMesh3d(p, R, canopyMesh.vertices, canopyMesh.faces, modelScale, cam);
      drawPolygon3d(p, R, [[0.65, -0.13, -0.10], [0.43, -0.215, -0.205], [0.08, -0.255, -0.255], [-0.10, -0.255, -0.17], [0.25, -0.245, -0.05]], modelScale, "#082f49", "#bae6fd", cam);
      drawPolygon3d(p, R, [[0.65, 0.13, -0.10], [0.43, 0.215, -0.205], [0.08, 0.255, -0.255], [-0.10, 0.255, -0.17], [0.25, 0.245, -0.05]], modelScale, "#0c4a6e", "#e0f2fe", cam);
      drawPolygon3d(p, R, [[0.55, -0.225, 0.05], [0.18, -0.255, 0.24], [-0.30, -0.215, 0.12], [-0.15, -0.24, 0.02]], modelScale, "#f8fafc", "#fff7ed", cam);
      drawPolygon3d(p, R, [[0.55, 0.225, 0.05], [0.18, 0.255, 0.24], [-0.30, 0.215, 0.12], [-0.15, 0.24, 0.02]], modelScale, "#ffedd5", "#ffffff", cam);
      drawPolygon3d(p, R, [[0.48, -0.235, 0.11], [0.08, -0.27, 0.25], [-0.08, -0.25, 0.17], [0.30, -0.245, 0.03]], modelScale, "#facc15", "#713f12", cam);
      drawPolygon3d(p, R, [[0.48, 0.235, 0.11], [0.08, 0.27, 0.25], [-0.08, 0.25, 0.17], [0.30, 0.245, 0.03]], modelScale, "#fde047", "#713f12", cam);

      // Main shaft, swashplate, blade grips, pitch links, and broad carbon blades.
      drawLine3d(p, R, [0, 0, -0.08], [0, 0, -0.53], modelScale, "#e2e8f0", 4, cam);
      drawLine3d(p, R, [-0.13, 0, -0.34], [0.13, 0, -0.34], modelScale, "#38bdf8", 4, cam);
      drawLine3d(p, R, [0, -0.13, -0.34], [0, 0.13, -0.34], modelScale, "#38bdf8", 4, cam);
      drawLine3d(p, R, [0.08*c, 0.08*s, -0.35], [0.20*c, 0.20*s, -0.50], modelScale, "#f8fafc", 2, cam);
      drawLine3d(p, R, [-0.08*c, -0.08*s, -0.35], [-0.20*c, -0.20*s, -0.50], modelScale, "#f8fafc", 2, cam);
      drawLine3d(p, R, [-0.23*c, -0.23*s, -0.50], [0.23*c, 0.23*s, -0.50], modelScale, "#cbd5e1", 8, cam);
      drawLine3d(p, R, [-1.38*c, -1.38*s, -0.505], [1.38*c, 1.38*s, -0.505], modelScale, "#94a3b8", 3, cam, 0.22);
      for (const direction of [-1, 1]) {
        drawPolygon3d(p, R, rotorBladePolygon(c, s, direction, 0.22, 1.40, 0.055, 0.035, -0.50), modelScale, direction > 0 ? "#94a3b8" : "#cbd5e1", "#f8fafc", cam);
        drawPolygon3d(p, R, rotorBladePolygon(c, s, direction, 1.16, 1.40, 0.040, 0.035, -0.505), modelScale, direction > 0 ? "#f97316" : "#facc15", "#fff7ed", cam);
      }
      drawMarker3d(p, R, [0, 0, -0.50], modelScale, 6, "#f59e0b", "#fff7ed", cam, 7);

      // Two-blade tail rotor with visible blade chord and pitch-control hub.
      const tailPhase = rotorPhase * 4.7;
      const tc = Math.cos(tailPhase), ts = Math.sin(tailPhase);
      for (const direction of [-1, 1]) {
        drawPolygon3d(p, R, tailBladePolygon(tc, ts, direction), modelScale, direction > 0 ? "#f8fafc" : "#facc15", "#0f172a", cam);
      }
      drawMarker3d(p, R, [-1.57, -0.045, 0], modelScale, 5, "#f97316", "#fff7ed", cam, 5);

      // Small navigation lights preserve left/right orientation without an
      // artificial nose arrow or label.
      drawMarker3d(p, R, [-1.18, -0.39, 0.00], modelScale, 3, "#ef4444", "#fee2e2", cam, 7);
      drawMarker3d(p, R, [-1.18, 0.39, 0.00], modelScale, 3, "#22c55e", "#dcfce7", cam, 7);

      // Sort every component together. This prevents a far tail rotor, skid,
      // or mast from covering a nearer canopy merely because it was declared later.
      flushHelicopterRenderQueue();

    }


let mode='roll', started=performance.now();
const labels={roll:'Roll · tilt side to side',pitch:'Pitch · nose up and down',yaw:'Yaw · turn the body',positive:'Positive collective · thrust above the rotor',negative:'Negative collective · thrust below the rotor'};
const controls=[...document.querySelectorAll('[data-model-mode]')];
controls.forEach(button=>button.addEventListener('click',()=>{
 mode=button.dataset.modelMode;started=performance.now();
 controls.forEach(b=>b.setAttribute('aria-pressed',b===button));
 document.getElementById('model-mode').textContent=labels[mode];
 draw(started);
}));
function rotation(roll,pitch,yaw){
 const cr=Math.cos(roll),sr=Math.sin(roll),cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);
 return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr],[sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr],[-sp,cp*sr,cp*cr]];
}
function strokeWorld(points,cam,color,width,dashed=false){
 const projected=points.map(p=>project(p,cam));if(projected.some(p=>!p))return;
 ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;if(dashed)ctx.setLineDash([4,5]);
 ctx.beginPath();projected.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();ctx.restore();
}
function thrustArrow(p,R,cam,sign){
 const a=project(bodyToWorld(p,R,[0,0,-.5],1),cam);
 const b=project(bodyToWorld(p,R,[0,0,-.5-sign*1.05],1),cam);
 if(!a||!b)return;const color=sign>0?'#157e78':'#a56d27';
 const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
 ctx.save();ctx.strokeStyle=color;ctx.lineWidth=4;ctx.lineCap='round';
 ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
 ctx.beginPath();ctx.moveTo(b[0]-11*Math.cos(angle-.5),b[1]-11*Math.sin(angle-.5));ctx.lineTo(...b);ctx.lineTo(b[0]-11*Math.cos(angle+.5),b[1]-11*Math.sin(angle+.5));ctx.stroke();
 ctx.fillStyle=color;ctx.font='650 12px Manrope, sans-serif';ctx.textAlign='left';ctx.fillText('Rotor thrust',(a[0]+b[0])/2+13,(a[1]+b[1])/2+4);ctx.restore();
}
function draw(now){
 if(canvas.closest('.slide').hidden)return;
 const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
 const dpr=window.devicePixelRatio||1;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const isStatic=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const t=isStatic?.3:(now-started)/1000;
 const wave=Math.sin(t*1.35)*.43;
 const R=rotation(mode==='roll'?wave:0,mode==='pitch'?wave:0,mode==='yaw'?Math.sin(t*.9)*.85:0);
 const p=[0,0,0],cam=perspectiveCamera([3.8,5.5,-3.3],[-.2,0,-.1],'fixed');
 // Frame the native aircraft at a readable size without changing its geometry.
 cam.fovDeg=34;
 activeCameraDepthDirection=cam.forward;
 const I=rotation(0,0,0);
 for(let j=-3;j<=3;j++){
  strokeWorld([[j,-3,.8],[j,3,.8]],cam,'#142a3910',1);
  strokeWorld([[-3,j,.8],[3,j,.8]],cam,'#142a3910',1);
 }
 if(['roll','pitch','yaw'].includes(mode)){
  const axis=mode==='roll'?0:mode==='pitch'?1:2;
  const ends=[-1.9,1.9].map(n=>{const v=[0,0,0];v[axis]=n;return bodyToWorld(p,R,v,1)});
  strokeWorld(ends,cam,'#157e7875',1.5,true);
 }
 drawHelicopter(p,R,cam,false,isStatic?.08:now/1000*.13,1);
 if(mode==='positive'||mode==='negative')thrustArrow(p,R,cam,mode==='positive'?1:-1);
}
// Share the simulator mesh between the testbed frame and the symmetry example.
const symmetryDialog=document.getElementById('symmetry-dialog');
const symmetryCanvas=document.getElementById('symmetry-model');
const symmetryPause=document.getElementById('symmetry-pause');
const symmetrySecondCaption=document.getElementById('symmetry-caption-two');
let symmetryElapsed=0,symmetryLast=0,symmetryPlaying=false;
const symmetryDuration=8000;
const fixedTilt=rotation(.22,-.30,.20);
function multiplyRotation(A,B){return A.map(row=>B[0].map((_,j)=>row.reduce((sum,v,k)=>sum+v*B[k][j],0)))}
function resetSymmetry(){
 symmetryElapsed=0;symmetryLast=performance.now();
 symmetryPlaying=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 symmetrySecondCaption.hidden=symmetryPlaying;
 symmetryPause.disabled=!symmetryPlaying;
 symmetryPause.textContent=symmetryPlaying?'Pause animation':'Animation paused';
 drawSymmetry(symmetryLast);
}
document.getElementById('symmetry-open').addEventListener('click',()=>{symmetryDialog.showModal();resetSymmetry()});
document.getElementById('symmetry-replay').addEventListener('click',resetSymmetry);
symmetryPause.addEventListener('click',()=>{
 symmetryPlaying=!symmetryPlaying;symmetryLast=performance.now();
 symmetryPause.textContent=symmetryPlaying?'Pause animation':'Resume animation';
});
symmetryDialog.addEventListener('close',()=>{symmetryPlaying=false;symmetryLast=0});
function drawSymmetry(now){
 if(!symmetryDialog.open)return;
 if(symmetryPlaying){symmetryElapsed=Math.min(symmetryDuration,symmetryElapsed+Math.max(0,now-symmetryLast));}
 symmetryLast=now;
 if(symmetryElapsed>=3000)symmetrySecondCaption.hidden=false;
 if(symmetryElapsed>=symmetryDuration){symmetryPlaying=false;symmetryPause.disabled=true;symmetryPause.textContent='Turn complete';}
 canvas=symmetryCanvas;ctx=canvas.getContext('2d');
 const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
 if(!w||!h){canvas=testbedCanvas;ctx=canvas.getContext('2d');return;}
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 // Right multiplication rotates about the body's rotor axis. The third
 // column remains fixed, so signed axial thrust is invariant throughout.
 const angle=symmetryElapsed/symmetryDuration*Math.PI*2;
 const R=multiplyRotation(fixedTilt,rotation(0,0,angle));
 const p=[0,0,0],cam=perspectiveCamera([3.8,5.5,-3.3],[-.15,0,-.35],'fixed');
 cam.fovDeg=52;activeCameraDepthDirection=cam.forward;
 strokeWorld([bodyToWorld(p,fixedTilt,[0,0,.75],1),bodyToWorld(p,fixedTilt,[0,0,-1.8],1)],cam,'#157e7855',1.5,true);
 drawHelicopter(p,R,cam,false,symmetryElapsed/1000*.13,1);
 thrustArrow(p,fixedTilt,cam,1);
 canvas=testbedCanvas;ctx=canvas.getContext('2d');
}

function tick(now){draw(now);drawSymmetry(now);requestAnimationFrame(tick)}

requestAnimationFrame(tick);
window.addEventListener('resize',()=>draw(performance.now()));
document.fonts.ready.then(()=>draw(performance.now()));
})();
