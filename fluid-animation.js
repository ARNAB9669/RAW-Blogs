// fluid-animation.js — GPU Navier-Stokes fluid & smoke simulation
// Adapted from Covelly fluid engine for RAW Get-App page [tbh an very old code of mine]

(function () {
    const canvas = document.querySelector('#webgl');
    if (!canvas) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

    const params = {
        dyeResolution: coarsePointer ? 512 : 1024,
        simResolution: coarsePointer ? 128 : 256,
        pressureIterations: coarsePointer ? 12 : 20,
        densityDissipation: 0.983,
        velocityDissipation: 0.98,
        pressure: 0.8,
        curl: 30,
        splatRadius: 0.25,
        pointerCoupling: 0.22,
        ambient: true,
        ambientForce: 45,
        bump: 14,
        grain: 0.035,
    };

    let gl = null;
    let ready = false;
    let running = false;
    let rafId = 0;
    const P = {};
    let velocity, dye, divergenceFBO, curlFBO, pressureFBO;
    let simSize, dyeSize, fboAspect = 1;

    /* ═════════════════════════ Shaders ═════════════════════════ */

    const baseVert = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

    const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

    const splatFrag = HEAD + `
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
out vec4 fragColor;
void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture(uTarget, vUv).xyz;
    fragColor = vec4(base + splat, 1.0);
}`;

    const advectionFrag = HEAD + `
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
out vec4 fragColor;
void main() {
    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
    vec4 result = texture(uSource, coord);
    float decay = pow(dissipation, dt * 60.0);
    fragColor = vec4(result.rgb * decay, 1.0);
}`;

    const divergenceFrag = HEAD + `
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main() {
    float L = texture(uVelocity, vL).x;
    float R = texture(uVelocity, vR).x;
    float T = texture(uVelocity, vT).y;
    float B = texture(uVelocity, vB).y;
    float div = 0.5 * (R - L + T - B);
    fragColor = vec4(div, 0.0, 0.0, 1.0);
}`;

    const curlFrag = HEAD + `
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main() {
    float L = texture(uVelocity, vL).y;
    float R = texture(uVelocity, vR).y;
    float T = texture(uVelocity, vT).x;
    float B = texture(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`;

    const vorticityFrag = HEAD + `
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
out vec4 fragColor;
void main() {
    float L = texture(uCurl, vL).x;
    float R = texture(uCurl, vR).x;
    float T = texture(uCurl, vT).x;
    float B = texture(uCurl, vB).x;
    float C = texture(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 vel = texture(uVelocity, vUv).xy;
    vel += force * dt;
    fragColor = vec4(vel, 0.0, 1.0);
}`;

    const pressureFrag = HEAD + `
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 fragColor;
void main() {
    float L = texture(uPressure, vL).x;
    float R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x;
    float B = texture(uPressure, vB).x;
    float div = texture(uDivergence, vUv).x;
    float p = (L + R + B + T - div) * 0.25;
    fragColor = vec4(p, 0.0, 0.0, 1.0);
}`;

    const gradientSubFrag = HEAD + `
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main() {
    float L = texture(uPressure, vL).x;
    float R = texture(uPressure, vR).x;
    float T = texture(uPressure, vT).x;
    float B = texture(uPressure, vB).x;
    vec2 vel = texture(uVelocity, vUv).xy;
    vel -= vec2(R - L, T - B);
    fragColor = vec4(vel, 0.0, 1.0);
}`;

    const clearFrag = HEAD + `
in vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
out vec4 fragColor;
void main() {
    fragColor = value * texture(uTexture, vUv);
}`;

    const displayFrag = HEAD + `
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBump;
uniform float uGrain;
out vec4 fragColor;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    float d  = texture(uTexture, vUv).r;
    float dl = texture(uTexture, vL).r;
    float dr = texture(uTexture, vR).r;
    float du = texture(uTexture, vT).r;
    float dd = texture(uTexture, vB).r;

    vec2 grad = vec2(dr - dl, du - dd);
    vec3 n = normalize(vec3(-grad * uBump, 1.0));
    float light = dot(n, normalize(vec3(-0.35, 0.55, 0.75)));

    float density = 1.0 - exp(-d * 1.7);
    float v = clamp(density * (0.78 + 0.42 * light), 0.0, 1.0);
    v = mix(v, v * v * (3.0 - 2.0 * v), 0.55);
    v *= 0.94;

    vec3 tint = mix(vec3(0.55, 0.58, 0.85), vec3(0.95, 0.96, 1.0), smoothstep(0.15, 0.85, v));
    vec3 col = v * tint;

    vec2 q = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    col *= 0.65 + 0.35 * smoothstep(1.25, 0.15, length(q));

    float g = hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
    col += g * uGrain * (0.35 + col);

    fragColor = vec4(max(col, 0.0), 1.0);
}`;

    /* ═════════════════════════ GL helpers ═════════════════════════ */

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    function createProgram(vertSrc, fragSrc) {
        const program = gl.createProgram();
        gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertSrc));
        gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragSrc));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program));
        }
        const uniforms = {};
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const info = gl.getActiveUniform(program, i);
            uniforms[info.name] = gl.getUniformLocation(program, info.name);
        }
        return { program, uniforms };
    }

    function blit(target) {
        if (target) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
            gl.viewport(0, 0, target.width, target.height);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function createFBO(w, h, internalFormat, format, type, filter) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        return { texture, fbo, width: w, height: h };
    }

    function deleteFBO(f) {
        if (!f) return;
        gl.deleteTexture(f.texture);
        gl.deleteFramebuffer(f.fbo);
    }

    function createDoubleFBO(w, h, internalFormat, format, type, filter) {
        let a = createFBO(w, h, internalFormat, format, type, filter);
        let b = createFBO(w, h, internalFormat, format, type, filter);
        return {
            width: w,
            height: h,
            get read() { return a; },
            get write() { return b; },
            swap() { [a, b] = [b, a]; },
            destroy() { deleteFBO(a); deleteFBO(b); },
        };
    }

    function getResolution(resolution) {
        let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
        if (aspect < 1) aspect = 1 / aspect;
        const min = Math.round(resolution);
        const max = Math.round(resolution * aspect);
        return gl.drawingBufferWidth > gl.drawingBufferHeight
            ? { width: max, height: min }
            : { width: min, height: max };
    }

    function initFramebuffers() {
        simSize = getResolution(params.simResolution);
        dyeSize = getResolution(params.dyeResolution);
        fboAspect = canvas.width / canvas.height;

        if (velocity) velocity.destroy();
        if (dye) dye.destroy();
        if (pressureFBO) pressureFBO.destroy();
        deleteFBO(divergenceFBO);
        deleteFBO(curlFBO);

        velocity = createDoubleFBO(simSize.width, simSize.height, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR);
        dye = createDoubleFBO(dyeSize.width, dyeSize.height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
        divergenceFBO = createFBO(simSize.width, simSize.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
        curlFBO = createFBO(simSize.width, simSize.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
        pressureFBO = createDoubleFBO(simSize.width, simSize.height, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.NEAREST);
    }

    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            return true;
        }
        return false;
    }

    /* ═════════════════════════ Simulation ═════════════════════════ */

    function splat(x, y, vx, vy, intensity, radius = params.splatRadius / 100) {
        const p = P.splat;
        gl.useProgram(p.program);
        gl.uniform1i(p.uniforms.uTarget, 0);
        gl.uniform1f(p.uniforms.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(p.uniforms.point, x, y);
        gl.uniform1f(p.uniforms.radius, radius);
        gl.activeTexture(gl.TEXTURE0);

        gl.uniform3f(p.uniforms.color, vx, vy, 0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        blit(velocity.write);
        velocity.swap();

        gl.uniform3f(p.uniforms.color, intensity, intensity, intensity);
        gl.bindTexture(gl.TEXTURE_2D, dye.read.texture);
        blit(dye.write);
        dye.swap();
    }

    function step(dt) {
        const tx = 1 / simSize.width;
        const ty = 1 / simSize.height;

        let p = P.curl;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, tx, ty);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.uniform1i(p.uniforms.uVelocity, 0);
        blit(curlFBO);

        p = P.vorticity;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, tx, ty);
        gl.uniform1f(p.uniforms.curl, params.curl);
        gl.uniform1f(p.uniforms.dt, dt);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, curlFBO.texture);
        gl.uniform1i(p.uniforms.uCurl, 1);
        blit(velocity.write);
        velocity.swap();

        p = P.divergence;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, tx, ty);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.uniform1i(p.uniforms.uVelocity, 0);
        blit(divergenceFBO);

        p = P.clear;
        gl.useProgram(p.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pressureFBO.read.texture);
        gl.uniform1i(p.uniforms.uTexture, 0);
        gl.uniform1f(p.uniforms.value, params.pressure);
        blit(pressureFBO.write);
        pressureFBO.swap();

        p = P.pressure;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, tx, ty);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, divergenceFBO.texture);
        gl.uniform1i(p.uniforms.uDivergence, 1);
        gl.uniform1i(p.uniforms.uPressure, 0);
        for (let i = 0; i < params.pressureIterations; i++) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, pressureFBO.read.texture);
            blit(pressureFBO.write);
            pressureFBO.swap();
        }

        p = P.gradientSub;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, tx, ty);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pressureFBO.read.texture);
        gl.uniform1i(p.uniforms.uPressure, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.uniform1i(p.uniforms.uVelocity, 1);
        blit(velocity.write);
        velocity.swap();

        p = P.advection;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, tx, ty);
        gl.uniform1f(p.uniforms.dt, dt);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.uniform1i(p.uniforms.uSource, 0);
        gl.uniform1f(p.uniforms.dissipation, params.velocityDissipation);
        blit(velocity.write);
        velocity.swap();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.uniform1i(p.uniforms.uVelocity, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, dye.read.texture);
        gl.uniform1i(p.uniforms.uSource, 1);
        gl.uniform1f(p.uniforms.dissipation, params.densityDissipation);
        blit(dye.write);
        dye.swap();
    }

    function render(time) {
        const p = P.display;
        gl.useProgram(p.program);
        gl.uniform2f(p.uniforms.texelSize, 1 / dyeSize.width, 1 / dyeSize.height);
        gl.uniform2f(p.uniforms.uResolution, canvas.width, canvas.height);
        gl.uniform1f(p.uniforms.uTime, time);
        gl.uniform1f(p.uniforms.uBump, params.bump);
        gl.uniform1f(p.uniforms.uGrain, params.grain);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, dye.read.texture);
        gl.uniform1i(p.uniforms.uTexture, 0);
        blit(null);
    }

    /* ═════════════════════════ Pointer input ═════════════════════════ */

    let prevPt = null;
    const trail = [];
    let pointerSpeed = 0;

    function pushPoint(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width;
        const y = 1 - (clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        if (!prevPt) prevPt = { x, y };
        trail.push({ x, y });
        if (trail.length > 64) trail.shift();
    }

    function resetPointer() {
        prevPt = null;
        trail.length = 0;
    }

    window.addEventListener('pointermove', (e) => {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const list = events.length ? events : [e];
        if (running) for (const ev of list) pushPoint(ev.clientX, ev.clientY);
    }, { passive: true });

    window.addEventListener('pointerdown', (e) => {
        if (!running) return;
        if (e.target && e.target.closest && (e.target.closest('button') || e.target.closest('a') || e.target.closest('input'))) return;
        resetPointer();
        pushPoint(e.clientX, e.clientY);
        if (ready && trail.length) {
            const pt = trail[0];
            splat(pt.x, pt.y, 0, 0, 0.45, (params.splatRadius / 100) * 2.5);
        }
    }, { passive: true });

    const endTouch = (e) => { if (e.pointerType === 'touch') resetPointer(); };
    window.addEventListener('pointerup', endTouch, { passive: true });
    window.addEventListener('pointercancel', endTouch, { passive: true });

    document.documentElement.addEventListener('pointerleave', () => {
        resetPointer();
    });

    function processPointer(realDt) {
        if (!prevPt || trail.length === 0) {
            pointerSpeed *= 0.92;
            return;
        }
        const last = trail[trail.length - 1];
        const dtp = Math.min(Math.max(realDt, 1 / 240), 1 / 20);
        const dx = last.x - prevPt.x;
        const dy = last.y - prevPt.y;
        const aspect = canvas.width / canvas.height;
        const dist = Math.hypot(dx * aspect, dy);
        const x0 = prevPt.x;
        const y0 = prevPt.y;
        prevPt = last;
        trail.length = 0;

        if (dist < 1e-5) {
            pointerSpeed *= 0.92;
            return;
        }

        pointerSpeed += (dist / dtp - pointerSpeed) * 0.35;

        const vx = (dx / dtp) * simSize.width * params.pointerCoupling;
        const vy = (dy / dtp) * simSize.height * params.pointerCoupling;

        const sigma = Math.sqrt(params.splatRadius / 100 / 2);
        const n = Math.min(10, Math.max(1, Math.ceil(dist / (sigma * 1.1))));
        const k = n > 1 ? 0.6 : 1;
        const intensity = Math.min(0.55, 0.1 + pointerSpeed * 0.09) * k;

        for (let i = 1; i <= n; i++) {
            const t = i / n;
            splat(x0 + dx * t, y0 + dy * t, vx * k, vy * k, intensity);
        }
    }

    /* ═════════════════════════ Intro + ambient ═════════════════════════ */

    function buildIntro() {
        const q = [];
        const F = 420;
        const R = 0.009;

        [0.15, 0.35, 0.5, 0.65, 0.85].forEach((x, i) => {
            q.push({ t: i * 0.07, x, y: 0.0, vx: (0.5 - x) * F * 1.4, vy: F, i: 0.6, r: R });
        });
        [[0.0, 0.35], [0.0, 0.7], [1.0, 0.35], [1.0, 0.7]].forEach(([x, y], i) => {
            q.push({ t: 0.25 + i * 0.08, x, y, vx: (0.5 - x) * F * 2, vy: (0.5 - y) * F, i: 0.55, r: R });
        });
        for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + 0.4;
            q.push({
                t: 0.8 + k * 0.05, x: 0.5, y: 0.5,
                vx: Math.cos(a) * F * 0.9, vy: Math.sin(a) * F * 0.9,
                i: 0.7, r: R * 1.4,
            });
        }
        return q.sort((a, b) => a.t - b.t);
    }

    let intro = [];
    let elapsed = 0;
    let ambientTimer = 0;

    function emitAmbient(dt) {
        if (!params.ambient) return;
        ambientTimer += dt;
        if (ambientTimer < 0.05) return;
        ambientTimer = 0;
        const t = elapsed;
        const f = params.ambientForce;

        const x = 0.5 + Math.sin(t * 0.31) * 0.14 + Math.sin(t * 0.83 + 1.3) * 0.035;
        splat(x, 0.1, Math.sin(t * 1.1) * f * 0.35, f + Math.sin(t * 0.6) * f * 0.25, 0.04, 0.004);

        if (Math.sin(t * 1.7) > 0.7) {
            splat(0.28 + Math.sin(t * 0.5) * 0.08, 0.08, f * 0.4, f * 0.9, 0.025, 0.003);
        }
        if (Math.sin(t * 2.3) > 0.7) {
            splat(0.72 + Math.cos(t * 0.4) * 0.08, 0.08, -f * 0.4, f * 0.9, 0.025, 0.003);
        }
    }

    /* ═════════════════════════ Main loop ═════════════════════════ */

    let lastTime = performance.now();
    let slowFrames = 0;
    let downgraded = false;

    function frame(now) {
        if (!running) return;
        rafId = requestAnimationFrame(frame);

        const realDt = Math.max(0, (now - lastTime) / 1000);
        lastTime = now;
        const dt = Math.min(realDt, 1 / 30);
        elapsed += dt;

        while (intro.length && intro[0].t <= elapsed) {
            const s = intro.shift();
            splat(s.x, s.y, s.vx, s.vy, s.i, s.r);
        }

        processPointer(realDt);
        if (elapsed > 1.6) emitAmbient(dt);

        step(dt);
        render(elapsed);

        if (realDt > 1 / 40) slowFrames++;
        else slowFrames = Math.max(0, slowFrames - 1);
        if (!downgraded && elapsed > 3 && slowFrames > 90 && params.dyeResolution > 512) {
            downgraded = true;
            params.dyeResolution = 512;
            params.simResolution = Math.min(params.simResolution, 128);
            params.pressureIterations = 12;
            initFramebuffers();
        }
    }

    function start() {
        if (running || !ready) return;
        running = true;
        resetPointer();
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
    }

    function boot() {
        gl = canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
        });
        if (!gl) {
            console.warn('WebGL2 not supported for fluid animation');
            return;
        }

        const okFloat = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
        if (!okFloat) {
            console.warn('Float render targets not supported');
            return;
        }
        gl.getExtension('OES_texture_float_linear');

        resizeCanvas();

        const quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        P.splat = createProgram(baseVert, splatFrag);
        P.advection = createProgram(baseVert, advectionFrag);
        P.divergence = createProgram(baseVert, divergenceFrag);
        P.curl = createProgram(baseVert, curlFrag);
        P.vorticity = createProgram(baseVert, vorticityFrag);
        P.pressure = createProgram(baseVert, pressureFrag);
        P.gradientSub = createProgram(baseVert, gradientSubFrag);
        P.clear = createProgram(baseVert, clearFrag);
        P.display = createProgram(baseVert, displayFrag);

        initFramebuffers();

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeCanvas();
                const aspect = canvas.width / canvas.height;
                if (Math.abs(aspect - fboAspect) / fboAspect > 0.12) initFramebuffers();
            }, 120);
        });

        intro = reduceMotion ? [] : buildIntro();
        ready = true;
        start();
    }

    try {
        boot();
    } catch (err) {
        console.warn('Fluid simulation boot error:', err);
    }
})();
