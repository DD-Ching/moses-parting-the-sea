import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { CFG } from './config.js';
import { makeGlowTexture } from './util.js';

// A large inverted sphere with a procedural storm sky: churning clouds, a dark
// brooding dome overhead, and a shaft of holy light glowing at the far -Z end
// (where the parted path leads). Drives the overall colour key of the scene.
export function createSky(scene) {
  const uniforms = {
    uTime: { value: 0 },
    uTopColor: { value: new THREE.Color(CFG.col.sky) },
    uHorizon: { value: new THREE.Color(CFG.col.horizon) },
    uStorm: { value: new THREE.Color(0x05080f) },
    uHolyDir: { value: new THREE.Vector3(0, 0.03, -1).normalize() },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
    uHoly: { value: 0.0 },        // ramps up as the path opens
    uFlash: { value: 0.0 },       // lightning flash 0..1
  };

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vDir;
      uniform float uTime, uHoly, uFlash;
      uniform vec3 uTopColor, uHorizon, uStorm, uHolyDir, uHolyColor;
      ${NOISE}
      void main(){
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

        // base vertical gradient: dark brooding top -> lighter storm horizon
        vec3 sky = mix(uHorizon, uTopColor, smoothstep(0.45, 0.95, h));
        sky = mix(uStorm, sky, smoothstep(0.0, 0.55, h));

        // rolling storm clouds via fbm over the dome
        vec3 q = dir * 2.4;
        q.x += uTime * 0.015;
        q.z += uTime * 0.01;
        float clouds = fbm(q + vec3(0.0, uTime*0.02, 0.0));
        float c2 = ridged(dir*4.0 + vec3(uTime*0.03, 0.0, 0.0));
        float cloudMask = smoothstep(-0.1, 0.7, clouds) * smoothstep(0.1, 0.9, h);
        vec3 cloudDark = mix(uStorm, vec3(0.10,0.13,0.18), c2*0.5);
        sky = mix(sky, cloudDark, cloudMask * 0.85);

        // a faint warm break in the clouds high up — divine intervention overhead
        float warmBreak = smoothstep(0.6, 1.0, clouds) * smoothstep(0.55, 1.0, h);
        sky += vec3(0.5,0.36,0.2) * warmBreak * 0.18;

        // holy light glowing at the far end of the corridor: a bright core with
        // a broad warm bloom, sitting just above the horizon down the path
        float toHoly = max(dot(dir, normalize(uHolyDir)), 0.0);
        float core = pow(toHoly, 320.0) * 0.85;
        float bloom = pow(toHoly, 40.0) * 0.28 + pow(toHoly, 11.0) * 0.07;
        sky += uHolyColor * (core + bloom) * uHoly;

        // lightning: brief uniform brightening biased toward the upper dome
        sky += vec3(0.7,0.78,0.95) * uFlash * (0.25 + 0.6*smoothstep(0.3,1.0,h));

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });

  const geo = new THREE.SphereGeometry(900, 48, 32);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // The destination light: a glowing beacon at the far end of the path. Two
  // stacked additive sprites (a tight core + a soft halo) read as a sun/portal
  // toward which the multitude flees, and bloom turns it luminous.
  const beacon = new THREE.Group();
  const haloMat = new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255,240,205,0.95)', 'rgba(255,210,150,0)'),
    color: 0xfff0cf, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(95, 62, 1);
  const coreMat = new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255,255,250,1)', 'rgba(255,240,210,0)'),
    color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Sprite(coreMat);
  core.scale.set(30, 30, 1);
  beacon.add(halo, core);
  beacon.position.set(0, 11, CFG.forwardZ - 30);
  beacon.frustumCulled = false;
  scene.add(beacon);

  return {
    mesh, beacon, uniforms,
    update(t) {
      uniforms.uTime.value = t;
      coreMat.rotation = Math.sin(t * 0.2) * 0.05;
    },
    follow(cam) { mesh.position.copy(cam.position); },
    setHoly(v) {
      uniforms.uHoly.value = v;
      haloMat.opacity = 0.3 * v;
      coreMat.opacity = 0.42 * v;
    },
    setFlash(v) { uniforms.uFlash.value = v; },
  };
}
