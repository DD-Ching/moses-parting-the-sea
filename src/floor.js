import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { CFG } from './config.js';

// The dry ground revealed between the walls — wet, glistening sea-floor with
// animated caustics, puddles, and the holy light reflecting off toward the far
// end — plus the "flood": a sheet of water that splits down the middle and
// drains outward as the sea divides.
export function createFloor(scene) {
  const Lz = CFG.backZ - CFG.forwardZ;
  const midZ = (CFG.backZ + CFG.forwardZ) / 2;
  const W = CFG.corridorHalf * 2;

  // -------- wet sea-floor --------
  const floorU = {
    uTime: { value: 0 },
    uHoly: { value: 0 },
    uFlash: { value: 0 },
    uSand: { value: new THREE.Color(CFG.col.sand) },
    uSandWet: { value: new THREE.Color(CFG.col.sandWet) },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
  };
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorU,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 w = modelMatrix * vec4(position,1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld; varying vec2 vUv;
      uniform float uTime, uHoly, uFlash;
      uniform vec3 uSand, uSandWet, uHolyColor;
      ${NOISE}
      void main(){
        // ribbed wet sand
        float ripple = fbm(vec3(vWorld.x*0.5, vWorld.z*0.18, 0.0));
        float ribs = sin(vWorld.z*0.6 + ripple*2.0)*0.5+0.5;
        vec3 col = mix(uSand, uSandWet, smoothstep(0.2,0.9, ribs*0.6 + ripple*0.5));

        // puddles: low areas hold water, darker + reflective
        float pud = smoothstep(0.35, 0.75, fbm(vec3(vWorld.x*0.12, vWorld.z*0.05, 7.0)));
        col = mix(col, uSandWet*0.7, pud);

        // animated caustic web from the holy light
        vec3 cp = vec3(vWorld.x*0.22, uTime*0.25, vWorld.z*0.1);
        float caust = ridged(cp);
        caust = pow(caust, 3.0);
        float toLight = smoothstep(40.0, -440.0, vWorld.z); // brighter toward the light
        col += uHolyColor * caust * (0.10 + 0.30*toLight) * (0.4 + 0.6*pud) * (0.4 + uHoly*0.7);

        // wet specular sheen toward the far light, riding the puddles
        float sheen = pow(toLight, 2.0) * (0.2 + pud*0.7) * (0.2 + uHoly*0.6);
        col += uHolyColor * sheen * 0.32;

        // lightning kick on wet ground
        col += vec3(0.4,0.5,0.7) * uFlash * (0.15 + pud*0.5);

        // distance haze
        float dist = length(cameraPosition - vWorld);
        col = mix(col, vec3(0.05,0.08,0.13), smoothstep(120.0, 520.0, dist)*0.9);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const floorGeo = new THREE.PlaneGeometry(W + 4, Lz, 8, 8);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(0, 0, midZ);
  floor.frustumCulled = false;
  scene.add(floor);

  // -------- the receding flood (splits + drains) --------
  const floodU = {
    uTime: { value: 0 },
    uSplit: { value: 0 },     // 0 = sea covers path, 1 = fully divided/drained
    uHalf: { value: CFG.corridorHalf },
    uHoly: { value: 0 },
    uDeep: { value: new THREE.Color(CFG.col.deepSea) },
    uMid: { value: new THREE.Color(CFG.col.sea) },
    uFoam: { value: new THREE.Color(CFG.col.foam) },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
  };
  const floodMat = new THREE.ShaderMaterial({
    uniforms: floodU,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float;
      uniform float uTime;
      varying vec3 vWorld; varying float vLocalX;
      ${NOISE}
      void main(){
        vLocalX = position.x;
        vec3 p = position;
        // surface ripples
        p.z += sin(position.x*0.5 + uTime*1.5)*0.12;
        p.z += fbm(vec3(position.x*0.3, position.y*0.3, uTime*0.4))*0.25;
        vec4 w = modelMatrix * vec4(p,1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld; varying float vLocalX;
      uniform float uTime, uSplit, uHalf, uHoly;
      uniform vec3 uDeep, uMid, uFoam, uHolyColor;
      ${NOISE}
      void main(){
        float ax = abs(vLocalX);
        float gap = uSplit * (uHalf + 3.0);        // opening grows from the centre
        if(ax < gap) discard;                       // dry ground exposed

        vec3 V = normalize(cameraPosition - vWorld);
        vec3 col = mix(uDeep, uMid, 0.5 + 0.5*sin(vWorld.z*0.2 + uTime));
        float caust = ridged(vec3(vWorld.x*0.3, uTime*0.5, vWorld.z*0.15));
        col += uMid * pow(caust,2.0)*0.4;
        col += uHolyColor * uHoly * 0.12;

        // bright churning foam along the receding edge
        float edge = exp(-pow((ax - gap)/2.2, 2.0));
        col = mix(col, uFoam, clamp(edge*1.2,0.0,1.0));

        // global fade as the waters withdraw into the walls
        float a = (1.0 - uSplit*0.9);
        a *= smoothstep(gap-0.5, gap+2.0, ax);
        gl_FragColor = vec4(col, a*0.92);
      }
    `,
  });
  // plane in XY -> lay flat (rotateX), so position.x stays the corridor-cross axis
  const floodGeo = new THREE.PlaneGeometry(W + 1, Lz, 80, 160);
  floodGeo.rotateX(-Math.PI / 2);
  const flood = new THREE.Mesh(floodGeo, floodMat);
  flood.position.set(0, 0.18, midZ);
  flood.frustumCulled = false;
  flood.renderOrder = 2;
  scene.add(flood);

  return {
    floor, flood,
    update(t) { floorU.uTime.value = t; floodU.uTime.value = t; },
    setHoly(v) { floorU.uHoly.value = v; floodU.uHoly.value = v; },
    setFlash(v) { floorU.uFlash.value = v; },
    setSplit(v) { floodU.uSplit.value = v; },
  };
}
