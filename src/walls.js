import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { CFG } from './config.js';

// The two towering walls of water held back on the right hand and the left.
// Each is a tall, heavily-subdivided plane displaced inward (toward the
// corridor) by layered noise, with a churning foam crest, fresnel glass rim,
// caustic shimmer, and subsurface glow from the holy light at the far end.
export function createWalls(scene) {
  const Lz = CFG.backZ - CFG.forwardZ;           // length of the corridor walls
  const midZ = (CFG.backZ + CFG.forwardZ) / 2;
  const H = CFG.wallHeight;

  const sharedUniforms = {
    uTime: { value: 0 },
    uRise: { value: 0 },          // 0 = flat sea, 1 = fully risen wall
    uHeight: { value: H },
    uHoly: { value: 0 },
    uFlash: { value: 0 },
    uDeep: { value: new THREE.Color(CFG.col.deepSea) },
    uMid: { value: new THREE.Color(CFG.col.sea) },
    uCrest: { value: new THREE.Color(CFG.col.seaCrest) },
    uFoam: { value: new THREE.Color(CFG.col.foam) },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
    uHolyDir: { value: new THREE.Vector3(0, 0.05, -1).normalize() },
  };

  function makeWall(side) {
    // side = -1 (left, x=-half), +1 (right, x=+half)
    const uniforms = THREE.UniformsUtils.clone(sharedUniforms);
    // keep color/vector uniforms shared by reference so one update drives both:
    uniforms.uTime = sharedUniforms.uTime;
    uniforms.uRise = sharedUniforms.uRise;
    uniforms.uHoly = sharedUniforms.uHoly;
    uniforms.uFlash = sharedUniforms.uFlash;
    uniforms.uHeight = sharedUniforms.uHeight;
    uniforms.uSide = { value: side };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      transparent: false,
      vertexShader: /* glsl */`
        precision highp float;
        uniform float uTime, uRise, uHeight, uSide;
        varying vec3 vWorld;
        varying float vY, vChurn, vCrest, vVel;
        ${NOISE}

        void main(){
          vec3 pos = position;          // local: x along corridor, y in [0,H], z=0
          float yN = clamp(pos.y / uHeight, 0.0, 1.0);

          // domain-warped churn, scrolling upward; stronger toward the crest
          vec3 sp = vec3(pos.x*0.05, pos.y*0.045 - uTime*0.28, uSide*13.0);
          float churn = fbm(sp);
          float fine  = fbm(sp*3.1 + vec3(0.0, -uTime*0.5, 0.0));
          float vel = fbm(sp*1.7 + vec3(uTime*0.2,0.0,0.0)); // local vertical velocity-ish

          // inward bulge (toward corridor center = +local Z); leans over near top
          float lean = smoothstep(0.2, 1.0, yN);
          float amp = (1.2 + 5.5*lean);
          float disp = (churn*0.7 + fine*0.3) * amp;

          // ragged, wobbling crest line
          float crestWobble = fbm(vec3(pos.x*0.08, uTime*0.2, uSide*5.0)) * 6.0;

          // rise animation: wall grows from the base; before rising it's a low swell
          float risenH = mix(2.5, uHeight + crestWobble, uRise);
          float y = yN * risenH;
          // settle the inward bulge in as it rises
          disp *= mix(0.15, 1.0, uRise);

          pos.y = y;
          pos.z += disp;                 // local +Z, rotated to face corridor

          vChurn = churn;
          vCrest = smoothstep(0.82, 1.0, y / max(risenH,0.001));
          vVel = vel;
          vY = y / uHeight;

          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime, uHoly, uFlash, uSide;
        uniform vec3 uDeep, uMid, uCrest, uFoam, uHolyColor, uHolyDir;
        varying vec3 vWorld;
        varying float vY, vChurn, vCrest, vVel;
        ${NOISE}

        void main(){
          // geometric normal from screen-space derivatives of world position
          vec3 dx = dFdx(vWorld);
          vec3 dy = dFdy(vWorld);
          vec3 N = normalize(cross(dx, dy));
          vec3 V = normalize(cameraPosition - vWorld);
          if(dot(N, V) < 0.0) N = -N;

          // vertical colour body: dark depths -> teal -> bright crest
          vec3 col = mix(uDeep, uMid, smoothstep(0.0, 0.55, vY));
          col = mix(col, uCrest, smoothstep(0.5, 1.0, vY) * 0.9);

          // moving caustic / refraction shimmer bands inside the water
          float caust = ridged(vec3(vWorld.z*0.06, vWorld.y*0.08 - uTime*0.4, uSide*3.0));
          col += uCrest * pow(caust, 2.0) * 0.25 * smoothstep(0.1,0.9,vY);

          // fresnel glass rim
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          col += mix(uMid, uCrest, vY) * fres * 0.9;

          // churning foam: crest band + turbulent streaks where velocity is high
          float foamNoise = fbm(vec3(vWorld.z*0.18, vWorld.y*0.16 - uTime*0.9, uSide*7.0));
          float foam = smoothstep(0.55, 1.0, vCrest + foamNoise*0.5);
          foam += smoothstep(0.75, 1.0, vVel + foamNoise*0.4) * 0.6 * smoothstep(0.2,0.9,vY);
          col = mix(col, uFoam, clamp(foam,0.0,1.0));

          // subsurface holy glow from the far light passing through the water
          float toHoly = max(dot(normalize(V*0.0 + uHolyDir), N), 0.0);
          col += uHolyColor * pow(toHoly,2.0) * uHoly * 0.5 * smoothstep(0.0,0.7,vY);
          // forward-facing translucency toward the light end
          float fwd = smoothstep(-200.0, -440.0, vWorld.z);
          col += uHolyColor * fwd * uHoly * 0.18;

          // lightning kick
          col += vec3(0.6,0.7,0.95) * uFlash * (0.3 + fres);

          // gentle depth haze so the far reaches of the wall fade out
          float dist = length(cameraPosition - vWorld);
          float haze = smoothstep(120.0, 520.0, dist);
          col = mix(col, vec3(0.05,0.09,0.14), haze*0.85);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    // plane in XY (x along corridor length, y up), normal +Z (local)
    const geo = new THREE.PlaneGeometry(Lz, H, 260, 96);
    geo.translate(0, H / 2, 0);     // base at y=0
    const mesh = new THREE.Mesh(geo, mat);
    // orient: local x -> world z, local +z -> world +x*(-side) facing the corridor
    mesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    mesh.position.set(side * CFG.corridorHalf, 0, midZ);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }

  const left = makeWall(-1);
  const right = makeWall(1);

  return {
    left, right,
    uniforms: sharedUniforms,
    update(t) { sharedUniforms.uTime.value = t; },
    setRise(v) { sharedUniforms.uRise.value = v; },
    setHoly(v) { sharedUniforms.uHoly.value = v; },
    setFlash(v) { sharedUniforms.uFlash.value = v; },
  };
}
