import * as THREE from 'three';
import { CFG } from './config.js';
import { makeGlowTexture } from './util.js';

// Moses at the head of the multitude: a tall robed silhouette who plants and
// raises his staff to part the sea, the tip blazing with holy light (the bloom
// pass makes it glow). He keeps a fixed lead ahead of the viewer.
export function createMoses(scene) {
  const group = new THREE.Group();

  const silU = {
    uHolyDir: { value: new THREE.Vector3(0, 0.12, -1).normalize() },
    uHolyColor: { value: new THREE.Color(CFG.col.holyLight) },
    uHoly: { value: 0.4 },
    uTorchColor: { value: new THREE.Color(CFG.col.torch) },
    uTorch: { value: 0 },
    uFlash: { value: 0 },
  };
  const silMat = new THREE.ShaderMaterial({
    uniforms: silU,
    vertexShader: /* glsl */`
      varying vec3 vWorld, vN;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vWorld, vN;
      uniform float uHoly, uTorch, uFlash;
      uniform vec3 uHolyDir, uHolyColor, uTorchColor;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N,V),0.0), 1.8);
        vec3 col = vec3(0.04,0.05,0.07);
        col += uHolyColor * fres * (0.7 + max(dot(N,uHolyDir),0.0)) * (0.8 + uHoly*1.6);
        vec3 td = normalize(vec3(0.0,0.1,1.0));
        col += uTorchColor * fres * max(dot(N,td),0.0) * uTorch * 1.3;
        col += vec3(0.6,0.7,0.95) * uFlash * fres;
        gl_FragColor = vec4(col,1.0);
      }
    `,
  });

  // body
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.78, 2.3, 9), silMat);
  robe.position.y = 1.15;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 9), silMat);
  torso.position.y = 2.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), silMat);
  head.position.y = 2.66;
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), silMat);
  beard.position.set(0, 2.42, 0.12); beard.rotation.x = Math.PI;
  group.add(robe, torso, head, beard);

  // raised arm + staff (pivot at shoulder so we can animate the raise)
  const armPivot = new THREE.Group();
  armPivot.position.set(0.3, 2.3, 0);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.1, 7), silMat);
  arm.position.y = 0.55; // extends up from pivot
  armPivot.add(arm);

  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.2, 7),
    new THREE.MeshBasicMaterial({ color: 0x2a1d12 }));
  staff.position.y = 1.4;
  armPivot.add(staff);

  // blazing tip
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xfff3da });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), tipMat);
  tip.position.y = 3.0;
  armPivot.add(tip);

  // additive halo around the tip
  const haloMat = new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255,231,176,0.95)', 'rgba(255,180,90,0)'),
    color: 0xffe7b0, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(3.2, 3.2, 1);
  halo.position.copy(tip.position);
  armPivot.add(halo);

  // a soft volumetric shaft rising from the staff (additive cone)
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xffeec4) } },
    vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `varying float vY; uniform float uOpacity; uniform vec3 uColor;
      void main(){ float a = (1.0-vY)*uOpacity; gl_FragColor = vec4(uColor, a*0.32); }`,
  });
  const shaft = new THREE.Mesh(new THREE.ConeGeometry(1.5, 26, 16, 1, true), shaftMat);
  shaft.position.set(0.3, 3.0 + 13, 0);
  group.add(shaft);

  group.add(armPivot);
  scene.add(group);

  // animation params
  const restArm = -0.5;     // arm down-ish at rest
  const raisedArm = -2.5;   // swung up overhead
  let curRaise = 0;

  function update(t, dt, camZ, surge, raise) {
    // lead ahead of the viewer, centred on the path
    const targetZ = camZ - 30;
    group.position.z += (targetZ - group.position.z) * Math.min(1, dt * 2.0);
    group.position.x = Math.sin(t * 0.6) * 0.3;
    // walking bob once marching
    const bob = Math.abs(Math.sin(t * 3.2)) * 0.06 * surge;
    group.position.y = bob;
    group.rotation.x = surge * 0.06;

    curRaise += (raise - curRaise) * Math.min(1, dt * 2.2);
    armPivot.rotation.z = restArm + (raisedArm - restArm) * curRaise * (group.position.x>0?1:1);
    armPivot.rotation.z = restArm + (raisedArm - restArm) * curRaise;

    const blaze = curRaise;
    tipMat.color.setRGB(1.15 * blaze + 0.1, 0.95 * blaze + 0.08, 0.65 * blaze + 0.05);
    haloMat.opacity = 0.42 * blaze;
    halo.scale.setScalar(1.6 + Math.sin(t * 4.0) * 0.2 * blaze + 1.1 * blaze);
    shaftMat.uniforms.uOpacity.value = 0.32 * blaze;
  }

  return {
    group, uniforms: silU, update,
    setHoly: (v) => { silU.uHoly.value = v; },
    setTorch: (v) => { silU.uTorch.value = v; },
    setFlash: (v) => { silU.uFlash.value = v; },
  };
}
