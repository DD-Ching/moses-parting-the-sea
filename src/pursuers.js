import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeGlowTexture } from './util.js';
import { CFG } from './config.js';

// Pharaoh's army at the viewer's back: a dense mass of spear-carrying
// silhouettes lit from within by guttering torches, kicking up dust as they
// press toward the corridor mouth. They loom closer over time but the walls
// hold them at the threshold.
export function createPursuers(scene) {
  // ---- soldier figure with spear ----
  const body = new THREE.CylinderGeometry(0.16, 0.34, 1.5, 6);
  body.translate(0, 0.75, 0);
  const head = new THREE.SphereGeometry(0.16, 7, 6);
  head.translate(0, 1.6, 0);
  const helm = new THREE.ConeGeometry(0.2, 0.4, 6);
  helm.translate(0, 1.78, 0);
  const spear = new THREE.CylinderGeometry(0.03, 0.03, 2.6, 5);
  spear.translate(0.28, 1.5, 0);
  const figure = mergeGeometries([body, head, helm, spear], false);

  const N = CFG.armyCount;
  const uniforms = {
    uTime: { value: 0 },
    uTorchColor: { value: new THREE.Color(CFG.col.torch) },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
    uHoly: { value: 0.2 },
    uFlash: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld, vN;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld, vN;
      uniform float uTime, uHoly, uFlash;
      uniform vec3 uTorchColor, uHolyColor;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N,V),0.0), 1.7);
        vec3 col = vec3(0.02,0.02,0.03);
        // warm torchlight from within/below the ranks, flickering
        float flick = 0.7 + 0.3*sin(uTime*12.0 + vWorld.x*3.0 + vWorld.z);
        vec3 td = normalize(vec3(0.0, -0.2, -1.0)); // toward the corridor (front of army)
        col += uTorchColor * (fres*0.8 + max(dot(N,td),0.0)*0.5) * flick * 0.9;
        // cold rim from the holy light leaking past
        col += uHolyColor * fres * uHoly * 0.4;
        col += vec3(0.6,0.7,0.95) * uFlash * fres;
        float dist = length(cameraPosition - vWorld);
        col = mix(col, vec3(0.05,0.05,0.07), smoothstep(120.0, 420.0, dist)*0.85);
        gl_FragColor = vec4(col,1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(figure, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const half = CFG.corridorHalf;
  const people = [];
  for (let i = 0; i < N; i++) {
    people.push({
      x: (Math.random() * 2 - 1) * (half + 6),
      zOff: Math.random() * 120,           // depth within the host
      phase: Math.random() * Math.PI * 2,
      stride: 4 + Math.random() * 2,
      scale: 0.95 + Math.random() * 0.4,
      speed: 0.8 + Math.random() * 0.5,
    });
  }

  // ---- torches: flickering additive points among the ranks ----
  const torchGeo = new THREE.BufferGeometry();
  const TN = 70;
  const tpos = new Float32Array(TN * 3);
  const tph = new Float32Array(TN);
  const torchRef = [];
  for (let i = 0; i < TN; i++) {
    const x = (Math.random() * 2 - 1) * (half + 5);
    const zOff = Math.random() * 110;
    torchRef.push({ x, zOff });
    tpos[i * 3] = x; tpos[i * 3 + 1] = 2.0 + Math.random() * 0.6; tpos[i * 3 + 2] = 0;
    tph[i] = Math.random() * 10;
  }
  torchGeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  torchGeo.setAttribute('aPhase', new THREE.BufferAttribute(tph, 1));
  const torchMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uTex: { value: makeGlowTexture('rgba(255,180,90,1)', 'rgba(255,80,0,0)') }, uSize: { value: 90 } },
    vertexShader: /* glsl */`
      attribute float aPhase; uniform float uTime, uSize; varying float vF;
      void main(){
        vF = 0.6 + 0.4*sin(uTime*15.0 + aPhase) + 0.2*sin(uTime*7.0+aPhase*2.0);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * vF * (300.0 / -mv.z);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; varying float vF;
      void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(t.rgb, t.a*vF); }
    `,
  });
  const torches = new THREE.Points(torchGeo, torchMat);
  torches.frustumCulled = false;
  scene.add(torches);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  // approach: 0 = far back, 1 = pressed up against the corridor mouth
  let approach = 0;

  function update(t, dt, camZ, _surge, targetApproach) {
    uniforms.uTime.value = t;
    torchMat.uniforms.uTime.value = t;
    approach += (targetApproach - approach) * Math.min(1, dt * 0.6);
    // the front rank sits this far behind the viewer; closes from ~120 to ~24
    const frontZ = camZ + (120 - approach * 96);
    for (let i = 0; i < N; i++) {
      const p = people[i];
      const walk = t * p.stride + p.phase;
      const bob = Math.abs(Math.sin(walk)) * 0.1;
      pos.set(p.x + Math.sin(walk * 0.5) * 0.15, bob, frontZ + p.zOff);
      const lean = -0.14 - Math.sin(walk) * 0.05; // leaning into the chase
      q.setFromEuler(new THREE.Euler(lean, 0, Math.sin(walk * 0.5) * 0.05));
      scl.set(p.scale, p.scale, p.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    // torches ride with the host
    const arr = torchGeo.attributes.position.array;
    for (let i = 0; i < TN; i++) {
      arr[i * 3 + 2] = frontZ + torchRef[i].zOff;
    }
    torchGeo.attributes.position.needsUpdate = true;
  }

  return {
    mesh, torches, uniforms, update,
    setHoly: (v) => { uniforms.uHoly.value = v; },
    setFlash: (v) => { uniforms.uFlash.value = v; },
  };
}
