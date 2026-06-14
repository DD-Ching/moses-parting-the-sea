import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE } from './glsl.js';
import { CFG } from './config.js';

// The fleeing multitude. Hundreds of robed figures (one InstancedMesh) walking
// the dry path toward the light, animated on the CPU (bob / sway / forward
// lean) and shaded as backlit silhouettes: a cool holy rim from the far light,
// a warm torch rim from the army behind, and a dim key fill up close.
export function createCrowd(scene) {
  // ---- build one robed figure, base at y=0 ----
  const robe = new THREE.CylinderGeometry(0.17, 0.52, 1.5, 7, 1);
  robe.translate(0, 0.75, 0);
  const head = new THREE.SphereGeometry(0.17, 8, 6);
  head.translate(0, 1.62, 0);
  const hood = new THREE.ConeGeometry(0.26, 0.46, 7);
  hood.translate(0, 1.5, -0.02);
  const figure = mergeGeometries([robe, head, hood], false);

  const N = CFG.crowdCount;
  const uniforms = {
    uTime: { value: 0 },
    uHolyDir: { value: new THREE.Vector3(0, 0.12, -1).normalize() },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
    uHoly: { value: 0.25 },
    uTorchColor: { value: new THREE.Color(CFG.col.torch) },
    uTorch: { value: 0.0 },
    uKeyColor: { value: new THREE.Color(0x6f86a8) },
    uFlash: { value: 0.0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      precision highp float;
      uniform float uTime;
      varying vec3 vWorld, vN, vCol;
      ${NOISE}
      void main(){
        vCol = instanceColor;
        vec3 p = position;
        // subtle hem flutter: lower part of robe sways
        float hem = clamp(1.0 - p.y/1.5, 0.0, 1.0);
        float ph = instanceMatrix[3][0]*0.7 + instanceMatrix[3][2]*0.5;
        p.x += sin(uTime*2.0 + ph) * hem * 0.07;
        p.z += cos(uTime*1.7 + ph) * hem * 0.05;

        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld, vN, vCol;
      uniform float uTime, uHoly, uTorch, uFlash;
      uniform vec3 uHolyDir, uHolyColor, uTorchColor, uKeyColor;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N,V),0.0), 3.2);

        // deep silhouette base
        vec3 col = vCol * 0.045;

        // cool holy rim from the far light ahead — a crisp bright edge
        float backH = max(dot(N, uHolyDir), 0.0);
        col += uHolyColor * fres * (0.4 + backH*0.8) * (0.35 + uHoly*0.85);

        // warm torch rim from the army behind (+Z)
        vec3 torchDir = normalize(vec3(0.0, 0.1, 1.0));
        float backT = max(dot(N, torchDir), 0.0);
        col += uTorchColor * fres * backT * uTorch * 1.0;

        // very dim key fill so nearby figures aren't pure black
        float key = max(dot(N, normalize(vec3(0.3,0.6,0.4))), 0.0);
        col += uKeyColor * key * 0.03;

        col += vec3(0.5,0.6,0.85) * uFlash * fres;

        // distance fade into the haze
        float dist = length(cameraPosition - vWorld);
        col = mix(col, vec3(0.05,0.08,0.12), smoothstep(140.0, 460.0, dist)*0.85);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(figure, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // ---- per-person state ----
  const people = [];
  const robeCols = [CFG.col.robeA, CFG.col.robeB, CFG.col.robeC, CFG.col.robeD].map(c => new THREE.Color(c));
  const tmpC = new THREE.Color();
  const half = CFG.corridorHalf;
  // window of corridor the crowd occupies, relative to the camera
  const AHEAD = 300, BEHIND = 26;
  for (let i = 0; i < N; i++) {
    // bias density toward the centre lanes, leave the very middle as a path gap
    let x = (Math.random() * 2 - 1);
    x = Math.sign(x) * Math.pow(Math.abs(x), 1.3) * (half - 1.4);
    people.push({
      x,
      z: CFG.backZ - 5 - Math.random() * (AHEAD + BEHIND),
      lane: x,
      phase: Math.random() * Math.PI * 2,
      speed: 0.85 + Math.random() * 0.5,
      stride: 4.5 + Math.random() * 2.5,
      scale: 0.9 + Math.random() * 0.45,
      sway: 0.1 + Math.random() * 0.18,
    });
    tmpC.copy(robeCols[i % robeCols.length]).multiplyScalar(0.8 + Math.random() * 0.5);
    mesh.setColorAt(i, tmpC);
  }
  mesh.instanceColor.needsUpdate = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 0);

  function update(t, dt, camZ, surge) {
    uniforms.uTime.value = t;
    const moveAhead = AHEAD, moveBehind = BEHIND;
    for (let i = 0; i < N; i++) {
      const p = people[i];
      // march forward (-Z); pace scales with surge
      p.z -= p.speed * surge * dt * 9.0;
      // recycle: if they fall behind the camera, send them to the front
      if (p.z > camZ + moveBehind) {
        p.z -= (moveAhead + moveBehind);
        let nx = (Math.random() * 2 - 1);
        p.lane = Math.sign(nx) * Math.pow(Math.abs(nx), 1.3) * (half - 1.4);
      }
      const walk = t * p.stride + p.phase;
      const bob = Math.abs(Math.sin(walk)) * 0.09 * (0.4 + surge);
      const swayX = Math.sin(walk * 0.5) * p.sway * (0.4 + surge);
      pos.set(p.lane + swayX, bob, p.z);
      // face forward (-Z) with a forward lean that grows with the surge, plus walk tilt
      const lean = 0.05 + surge * 0.14 + Math.sin(walk) * 0.04;
      q.setFromEuler(new THREE.Euler(-lean, swayX * 0.2, Math.sin(walk * 0.5) * 0.05));
      scl.set(p.scale, p.scale * (1 - bob * 0.2), p.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    mesh, uniforms, update,
    setHoly: (v) => { uniforms.uHoly.value = v; },
    setTorch: (v) => { uniforms.uTorch.value = v; },
    setFlash: (v) => { uniforms.uFlash.value = v; },
  };
}
