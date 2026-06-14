import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CFG } from './config.js';
import { clamp01, smoothstep, lerp } from './util.js';
import { createSky } from './sky.js';
import { createWalls } from './walls.js';
import { createFloor } from './floor.js';
import { createCrowd } from './crowd.js';
import { createMoses } from './moses.js';
import { createPursuers } from './pursuers.js';
import { createParticles } from './particles.js';
import { createAudio } from './audio.js';

export async function boot() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2 && !renderer.getContext()) throw new Error('WebGL unavailable');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1400);
  camera.position.set(0, CFG.eyeHeight, 45);

  // ---- world ----
  const sky = createSky(scene);
  const walls = createWalls(scene);
  const floor = createFloor(scene);
  const crowd = createCrowd(scene);
  const moses = createMoses(scene);
  const pursuers = createPursuers(scene);
  const particles = createParticles(scene);
  const audio = createAudio();

  // lightning bolt (jagged additive line, hidden until it strikes)
  const boltMat = new THREE.LineBasicMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0.9 });
  const boltGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const bolt = new THREE.Line(boltGeo, boltMat);
  bolt.frustumCulled = false; bolt.visible = false;
  scene.add(bolt);

  // ---- postprocessing ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.36, 0.42, 0.86);
  composer.addPass(bloom);

  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 1.05 },
      uFlash: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime, uVignette, uFlash;
      void main(){
        vec2 uv = vUv;
        // subtle chromatic aberration toward the edges
        vec2 d = uv - 0.5;
        float r2 = dot(d,d);
        float ca = 0.0016 + uFlash*0.004;
        vec3 col;
        col.r = texture2D(tDiffuse, uv + d*ca).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - d*ca).b;
        // cool teal-shadow / warm-highlight grade
        float lum = dot(col, vec3(0.299,0.587,0.114));
        col = mix(col, col*vec3(0.92,1.0,1.06), 0.35);                 // cool overall
        col += vec3(0.06,0.04,0.0) * smoothstep(0.5,1.0,lum);          // warm highlights
        // vignette
        float vig = smoothstep(0.95, 0.25, r2*uVignette*1.6);
        col *= mix(0.45, 1.0, vig);
        // film grain
        float g = fract(sin(dot(uv*vec2(uTime*0.7+1.0, uTime*0.9+1.0), vec2(12.9898,78.233))) * 43758.5453);
        col += (g - 0.5) * 0.035;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  // ---- UI refs ----
  const loader = document.getElementById('loader');
  const intro = document.getElementById('intro');
  const hud = document.getElementById('hud');
  const subtitleEl = document.getElementById('subtitle');
  const exploreHint = document.getElementById('explore-hint');
  const beginBtn = document.getElementById('beginBtn');
  const audioBtn = document.getElementById('audioBtn');
  const replayBtn = document.getElementById('replay');
  const skipBtn = document.getElementById('skipBtn');

  // ---- state ----
  const clock = new THREE.Clock(false);
  let t = 0;                // experience time
  let camZ = 45;
  let started = false;
  let userYaw = 0, userPitch = 0;       // drag offsets (free mode)
  let tgtYaw = 0, tgtPitch = 0;
  let flashVal = 0;
  let nextStrike = 3.5;
  let frozen = false;
  const B = CFG.beats;

  // ---- subtitles ----
  const lines = [
    { t: 1.0, dur: 4.5, en: 'The sea ahead. The army at our backs.', zh: '前有大海，後有追兵' },
    { t: B.riseStart + 0.2, dur: 4.0, en: 'Moses stretches out his hand…', zh: '摩西向海伸杖' },
    { t: B.riseEnd - 0.5, dur: 4.5, en: 'And the waters were divided.', zh: '海水就分開了' },
    { t: B.surge + 0.5, dur: 4.5, en: 'Forward — upon the dry ground.', zh: '走進海中的乾地' },
    { t: B.lookBack + 0.3, dur: 4.0, en: 'Behind us, the host of Pharaoh.', zh: '法老的全軍追來' },
    { t: B.march + 0.5, dur: 5.5, en: 'A wall of water on the right hand, and on the left.', zh: '水在左右作了牆垣' },
    { t: B.free + 0.5, dur: 6.0, en: 'Walk on.', zh: '繼續前行 · 拖曳環顧四周' },
  ];
  let subIdx = -1;
  function updateSubtitles() {
    let active = -1;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].t && t < lines[i].t + lines[i].dur) active = i;
    }
    if (active !== subIdx) {
      subIdx = active;
      if (active >= 0) {
        subtitleEl.innerHTML = lines[active].en + '<span class="zh">' + lines[active].zh + '</span>';
        subtitleEl.classList.add('on');
      } else {
        subtitleEl.classList.remove('on');
      }
    }
  }

  // ---- lightning ----
  function strike() {
    flashVal = 1.0;
    // build a jagged bolt high in the sky, off to a random side
    const side = Math.random() < 0.5 ? -1 : 1;
    const x0 = side * (60 + Math.random() * 120);
    const z0 = camZ - 200 - Math.random() * 200;
    const pts = [];
    let x = x0, y = 380, z = z0;
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      pts.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 40;
      z += (Math.random() - 0.5) * 30;
      y -= 380 / steps;
    }
    boltGeo.setFromPoints(pts);
    bolt.visible = true;
    boltMat.opacity = 1.0;
    const delay = 0.3 + Math.random() * 0.8;   // thunder lags the flash
    setTimeout(() => audio.thunder(0.7 + Math.random() * 0.4), delay * 1000);
    nextStrike = t + 6 + Math.random() * 10;
  }

  // ---- director: drives every animated quantity from the timeline ----
  function director(dt) {
    const rise = smoothstep(B.riseStart, B.riseEnd, t);
    const split = smoothstep(B.riseStart, B.riseEnd - 1.0, t);
    const holy = smoothstep(B.riseStart + 1.0, B.riseEnd + 3.0, t);
    const surge = smoothstep(B.surge, B.surge + 7.0, t);
    const approach = Math.min(0.9, smoothstep(2.0, B.march + 10.0, t));
    // staff blazes up to part the sea, then recedes to a dim ember as we march
    const raise = smoothstep(B.riseStart - 0.3, B.riseStart + 1.5, t)
      * (1.0 - 0.82 * smoothstep(B.riseEnd, B.riseEnd + 5.0, t));

    // shared uniforms
    walls.update(t); walls.setRise(rise); walls.setHoly(holy);
    sky.update(t); sky.setHoly(holy);
    floor.update(t); floor.setHoly(holy); floor.setSplit(split);
    crowd.setHoly(0.25 + holy * 0.7); crowd.setTorch(approach);
    moses.setHoly(0.4 + holy); moses.setTorch(approach * 0.7);
    pursuers.setHoly(0.2 + holy * 0.3);

    // lightning flash decays; push to every shader + the grade pass
    if (t >= nextStrike) strike();
    flashVal = Math.max(0, flashVal - dt * 6.0);
    const fv = flashVal * (0.6 + 0.4 * Math.sin(t * 60.0));   // brief flicker
    walls.setFlash(fv); sky.setFlash(fv); floor.setFlash(fv);
    crowd.setFlash(fv); moses.setFlash(fv); pursuers.uniforms.uFlash.value = fv;
    grade.uniforms.uFlash.value = fv;
    if (bolt.visible) { boltMat.opacity *= 0.82; if (boltMat.opacity < 0.03) bolt.visible = false; }

    // advance through the corridor once the surge begins, but stop before the
    // far end so the viewer always stays held between the walls of water
    camZ = Math.max(-360, camZ - surge * 9.0 * dt);

    // update populated systems
    crowd.update(t, dt, camZ, 0.15 + surge);
    moses.update(t, dt, camZ, surge, raise);
    pursuers.update(t, dt, camZ, surge, approach);
    particles.update(t, dt, camZ, rise);

    // audio swell
    audio.setParting(holy);
    audio.setWind(0.3 + rise * 0.6);

    return { rise, surge, holy, approach };
  }

  // ---- camera placement ----
  function placeCamera(dt, st) {
    const free = t >= B.free;
    // smooth user drag in only once we hand over control
    const uy = free ? userYaw : 0, up = free ? userPitch : 0;
    tgtYaw += (uy - tgtYaw) * Math.min(1, dt * 4);
    tgtPitch += (up - tgtPitch) * Math.min(1, dt * 4);

    // scripted glance back at the army
    const lb = bump(t, B.lookBack, 4.2);
    let yaw = tgtYaw + Math.sin(t * 0.18) * 0.05 + lb * 2.5;
    let pitch = tgtPitch + Math.sin(t * 0.27) * 0.015
      + smoothstep(B.riseStart, B.riseEnd, t) * (1 - st.rise) * 0.10   // look up as walls climb
      + 0.04 * st.rise;

    // walking head-bob
    const walk = t * 5.2;
    const bobY = Math.abs(Math.sin(walk)) * 0.05 * (0.3 + st.surge);
    const roll = Math.sin(walk * 0.5) * 0.014 * (0.3 + st.surge);
    const swayX = Math.sin(t * 0.5) * 0.25 + Math.sin(walk * 0.5) * 0.05 * st.surge;

    camera.position.set(swayX, CFG.eyeHeight + bobY, camZ);
    const dir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
  }

  function bump(time, start, dur) {
    const x = (time - start) / dur;
    if (x <= 0 || x >= 1) return 0;
    return Math.sin(x * Math.PI);
  }

  // ---- loop ----
  function animate() {
    requestAnimationFrame(animate);
    const rawDt = Math.min(clock.getDelta(), 0.05);
    const dt = frozen ? 0 : rawDt;
    if (started && !frozen) t += dt;
    grade.uniforms.uTime.value = t;
    const st = started ? director(dt) : { rise: 0, surge: 0, holy: 0, approach: 0 };
    if (!started) { walls.update(t); sky.update(t); floor.update(t); }
    placeCamera(dt, st);
    sky.follow(camera);
    updateSubtitles();
    composer.render();
  }

  // ---- resize ----
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
  });

  // ---- input (drag to look, free mode) ----
  let dragging = false, lastX = 0, lastY = 0;
  function down(x, y) { dragging = true; lastX = x; lastY = y; }
  function move(x, y) {
    if (!dragging) return;
    userYaw = clampNum(userYaw + (x - lastX) * 0.0032, -1.2, 1.2);
    userPitch = clampNum(userPitch - (y - lastY) * 0.0026, -0.5, 0.55);
    lastX = x; lastY = y;
  }
  function up() { dragging = false; }
  canvas.addEventListener('pointerdown', e => down(e.clientX, e.clientY));
  addEventListener('pointermove', e => move(e.clientX, e.clientY));
  addEventListener('pointerup', up);
  function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- flow ----
  function begin() {
    if (started) return;
    started = true;
    clock.start();
    audio.start();
    intro.classList.add('hidden');
    hud.classList.add('show');
    document.body.classList.add('cinema');
    setTimeout(() => exploreHint.classList.add('on'), (B.free) * 1000);
    setTimeout(() => exploreHint.classList.remove('on'), (B.free + 8) * 1000);
  }
  function replay() {
    t = 0; camZ = 45; subIdx = -1; flashVal = 0; nextStrike = 3.5;
    userYaw = userPitch = tgtYaw = tgtPitch = 0;
    subtitleEl.classList.remove('on');
    clock.start();
  }
  function skip() {
    t = B.free; camZ = 45 - 9.0 * (B.free - B.surge); // approximate forward progress
    subIdx = -1;
  }

  beginBtn.addEventListener('click', begin);
  replayBtn.addEventListener('click', replay);
  skipBtn.addEventListener('click', skip);
  audioBtn.addEventListener('click', () => {
    const on = audio.toggle();
    audioBtn.style.opacity = on ? '1' : '0.4';
    audioBtn.textContent = on ? '♪' : '♪̸';
  });

  // ---- reveal ----
  // warm up one frame so the GPU compiles shaders before we show the title
  renderer.compile(scene, camera);
  animate();
  await new Promise(r => requestAnimationFrame(r));
  loader.classList.add('hidden');
  intro.classList.remove('hidden');

  window.__exp = {
    scene, camera, renderer, walls, crowd, moses,
    get t() { return t; }, get camZ() { return camZ; },
    setFrozen(b) { frozen = b; if (!b) clock.getDelta(); },
    seek(time, z) { t = time; if (z !== undefined) camZ = z; subIdx = -1; },
    setUser(y, p) { userYaw = tgtYaw = y; userPitch = tgtPitch = p; },
  };
  return { scene, camera, renderer };
}
