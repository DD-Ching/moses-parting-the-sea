import * as THREE from 'three';
import { makeGlowTexture } from './util.js';
import { CFG } from './config.js';

// Volumetric atmosphere: low drifting mist between the walls, fine spray
// cascading down the inner faces, and warm dust kicked up behind by the army.
export function createParticles(scene) {
  const half = CFG.corridorHalf;
  const softWhite = makeGlowTexture('rgba(220,240,255,0.9)', 'rgba(220,240,255,0)');
  const softWarm = makeGlowTexture('rgba(255,170,90,0.9)', 'rgba(255,90,20,0)');

  function makeLayer(count, tex, color, size, blending = THREE.AdditiveBlending) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const alpha = new Float32Array(count);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { uTex: { value: tex }, uColor: { value: new THREE.Color(color) }, uSize: { value: size } },
      vertexShader: /* glsl */`
        attribute float aAlpha; uniform float uSize; varying float vA;
        void main(){
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(uSize * (300.0 / -mv.z), 360.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor, t.a*vA); }
      `,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { geo, mat, pos, alpha, count };
  }

  // --- mist: slow low fog drifting along the floor (soft, not glowing) ---
  const mistTex = makeGlowTexture('rgba(150,180,205,0.55)', 'rgba(150,180,205,0)');
  const mist = makeLayer(260, mistTex, 0x6b93b0, 150, THREE.NormalBlending);
  const mistData = [];
  for (let i = 0; i < mist.count; i++) {
    mistData.push({
      x: (Math.random() * 2 - 1) * (half + 1),
      y: 0.3 + Math.random() * 3.0,
      z: 0, span: 320,
      drift: 1 + Math.random() * 2,
      sway: Math.random() * Math.PI * 2,
    });
    mist.alpha[i] = 0.05 + Math.random() * 0.08;
  }
  mist.geo.attributes.aAlpha.needsUpdate = true;

  // --- spray: fine droplets cascading down the inner wall faces ---
  const spray = makeLayer(700, softWhite, 0xeaf6ff, 26);
  const sprayData = [];
  for (let i = 0; i < spray.count; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    sprayData.push({
      side,
      x: side * (half - 0.3 - Math.random() * 1.5),
      y: Math.random() * CFG.wallHeight,
      z: 0, span: 300,
      vy: 4 + Math.random() * 10,
      sway: Math.random() * Math.PI * 2,
    });
    spray.alpha[i] = 0.0;
  }

  // --- dust: warm motes rising behind the army ---
  const dust = makeLayer(240, softWarm, 0xff9a4a, 80);
  const dustData = [];
  for (let i = 0; i < dust.count; i++) {
    dustData.push({
      x: (Math.random() * 2 - 1) * (half + 6),
      y: Math.random() * 8,
      zBack: 20 + Math.random() * 110,
      vy: 0.4 + Math.random() * 1.2,
      sway: Math.random() * Math.PI * 2,
    });
    dust.alpha[i] = 0.04 + Math.random() * 0.12;
  }
  dust.geo.attributes.aAlpha.needsUpdate = true;

  let sprayIntensity = 0;

  function update(t, dt, camZ, rise) {
    sprayIntensity += ((rise) - sprayIntensity) * Math.min(1, dt);
    // mist
    const mp = mist.pos;
    for (let i = 0; i < mist.count; i++) {
      const d = mistData[i];
      d.z += d.drift * dt;
      let z = camZ - 280 + ((d.z % d.span) + d.span) % d.span; // wrap ahead of camera
      mp[i * 3] = d.x + Math.sin(t * 0.2 + d.sway) * 1.5;
      mp[i * 3 + 1] = d.y + Math.sin(t * 0.3 + d.sway) * 0.4;
      mp[i * 3 + 2] = z;
    }
    mist.geo.attributes.position.needsUpdate = true;

    // spray
    const sp = spray.pos;
    for (let i = 0; i < spray.count; i++) {
      const d = sprayData[i];
      d.y -= d.vy * dt;
      d.z += dt * 1.2;
      if (d.y < 0) { d.y = CFG.wallHeight * (0.6 + Math.random() * 0.4); }
      let z = camZ - 250 + (((d.z) % d.span) + d.span) % d.span;
      sp[i * 3] = d.side * CFG.corridorHalf - d.side * (0.3 + Math.sin(t * 2 + d.sway) * 0.8 + (CFG.wallHeight - d.y) * 0.02);
      sp[i * 3 + 1] = d.y;
      sp[i * 3 + 2] = z;
      spray.alpha[i] = sprayIntensity * (0.15 + 0.35 * (d.y / CFG.wallHeight));
    }
    spray.geo.attributes.position.needsUpdate = true;
    spray.geo.attributes.aAlpha.needsUpdate = true;

    // dust behind the army
    const dp = dust.pos;
    for (let i = 0; i < dust.count; i++) {
      const d = dustData[i];
      d.y += d.vy * dt;
      if (d.y > 10) d.y = 0;
      dp[i * 3] = d.x + Math.sin(t * 0.5 + d.sway) * 1.0;
      dp[i * 3 + 1] = d.y;
      dp[i * 3 + 2] = camZ + d.zBack;
    }
    dust.geo.attributes.position.needsUpdate = true;
  }

  return { update };
}
