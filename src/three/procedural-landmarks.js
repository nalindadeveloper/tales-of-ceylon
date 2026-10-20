/**
 * Procedural placeholder landmarks, used whenever a destination's GLB model is
 * missing or fails to load. Built from Three.js primitives and simple custom
 * geometry, at diorama scale (1 unit = 1 km, roughly 6–8 km across) so they
 * read clearly from the destination camera distance.
 *
 * Every builder returns { object, update?(time, delta) } with the object's
 * base at y = 0 (parts extend below 0 so nothing floats on slopes).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from 'three';

/** Shared materials for all landmarks (created once, disposed by the manager). */
export function createLandmarkMaterials() {
  const standard = (color, options = {}) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.82, metalness: 0, ...options });
  return {
    ivory: standard('#efe6d3'),
    whitewash: standard('#f6f2ea', { roughness: 0.7 }),
    stone: standard('#b9aa8b', { roughness: 0.95 }),
    paleStone: standard('#d6c8a8', { roughness: 0.95 }),
    glass: standard('#7d9db4', { roughness: 0.28, metalness: 0.35 }),
    glassDeep: standard('#4d6a82', { roughness: 0.3, metalness: 0.35 }),
    terracotta: standard('#a4533a'),
    templeRed: standard('#b5532f'),
    ochre: standard('#d38b4b'),
    gold: standard('#d5ae5f', { roughness: 0.32, metalness: 0.65 }),
    lotus: standard('#c98a9c', { roughness: 0.55 }),
    teaHill: standard('#4f8a3d', { roughness: 1 }),
    teaBush: standard('#6aa248', { roughness: 0.9 }),
    trunk: standard('#6b5a48'),
    canopy: standard('#3b6a38', { roughness: 0.95 }),
    lawn: standard('#7d9a58', { roughness: 1 }),
    roofRed: standard('#9b3f2c'),
    charcoal: standard('#2b2e31', { roughness: 0.6 }),
    lantern: standard('#ffe2a8', { emissive: new Color('#ffcf7a'), emissiveIntensity: 1.6 }),
  };
}

function place(mesh, x = 0, y = 0, z = 0, rotationY = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Four-sided pyramid roof sized to a w × d footprint. */
function hipRoof(width, depth, height, material) {
  const roof = new Mesh(new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), material);
  roof.scale.set(width, height, depth);
  return roof;
}

function softSpriteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/* ---------------------------------------------------------------- */
/* Colombo — a modern skyline around the Lotus Tower                 */
/* ---------------------------------------------------------------- */
function buildSkyline(m) {
  const group = new Group();
  // [x, z, width, depth, height, shaft material]
  const towers = [
    [-0.7, -1.1, 0.7, 0.7, 5.0, m.glass], // twin towers
    [0.15, -1.2, 0.7, 0.7, 5.0, m.glass],
    [-1.9, -0.2, 0.9, 0.8, 3.6, m.glassDeep],
    [-1.2, 0.9, 1.0, 0.9, 2.4, m.ivory],
    [0.9, 0.3, 0.8, 0.8, 3.1, m.glassDeep],
    [-2.8, 0.9, 0.8, 0.7, 1.8, m.ivory],
    [1.0, -2.0, 0.9, 0.8, 2.2, m.ivory],
    [-2.4, -1.6, 0.7, 0.7, 2.8, m.glass],
    [0.0, 1.8, 1.1, 0.8, 1.4, m.ivory],
    [-0.3, 0.2, 0.6, 0.6, 3.9, m.glass],
  ];
  for (const [x, z, w, d, h, material] of towers) {
    const podium = place(new Mesh(new BoxGeometry(w * 1.25, 0.5 + 2, d * 1.25), m.ivory), x, -0.75, z);
    const shaft = place(new Mesh(new BoxGeometry(w, h + 1, d), material), x, h / 2 - 0.5, z);
    const crown = place(new Mesh(new BoxGeometry(w * 0.7, 0.25, d * 0.7), m.ivory), x, h + 0.12, z);
    group.add(podium, shaft, crown);
  }

  // Lotus Tower: slim tapering shaft, bud of petals, gilded spire.
  const lotus = new Group();
  lotus.add(place(new Mesh(new CylinderGeometry(0.13, 0.32, 7.5, 16), m.whitewash), 0, 3.75 - 1, 0));
  const bud = place(new Mesh(new SphereGeometry(0.5, 24, 16), m.lotus), 0, 6.75, 0);
  bud.scale.set(1, 1.35, 1);
  lotus.add(bud);
  for (let i = 0; i < 8; i++) {
    const petal = new Mesh(new ConeGeometry(0.2, 1, 8), m.lotus);
    const angle = (i / 8) * Math.PI * 2;
    petal.position.set(Math.cos(angle) * 0.42, 6.55, Math.sin(angle) * 0.42);
    petal.rotation.set(Math.sin(angle) * 0.45, 0, -Math.cos(angle) * 0.45);
    petal.castShadow = true;
    lotus.add(petal);
  }
  lotus.add(place(new Mesh(new CylinderGeometry(0.03, 0.06, 1.6, 8), m.gold), 0, 8.1, 0));
  lotus.position.set(2.2, 0, 0.9);
  group.add(lotus);
  return { object: group };
}

/* ---------------------------------------------------------------- */
/* Kandy — octagonal temple pavilion on a stone terrace              */
/* ---------------------------------------------------------------- */
function buildPavilion(m) {
  const group = new Group();
  const terraceTop = 0.35;
  group.add(place(new Mesh(new CylinderGeometry(3.3, 3.6, 3.4, 8), m.paleStone), 0, terraceTop - 1.7, 0, Math.PI / 8));

  // Main hall with a hipped terracotta roof and a gilded relic canopy.
  const hall = place(new Mesh(new BoxGeometry(3.4, 1.0, 1.5), m.whitewash), -0.3, terraceTop + 0.5, -0.9);
  const hallRoof = place(hipRoof(3.9, 1.95, 0.8, m.terracotta), -0.3, terraceTop + 1.4, -0.9);
  const canopyBase = place(new Mesh(new BoxGeometry(0.7, 0.45, 0.7), m.whitewash), -0.9, terraceTop + 1.9, -0.9);
  const canopyRoof = place(hipRoof(1.0, 1.0, 0.55, m.gold), -0.9, terraceTop + 2.4, -0.9);
  group.add(hall, hallRoof, canopyBase, canopyRoof);

  // The octagonal Pattirippuwa with two roof tiers and a finial.
  const octagon = new Group();
  octagon.add(place(new Mesh(new CylinderGeometry(0.8, 0.85, 1.4, 8), m.whitewash), 0, 0.7, 0));
  octagon.add(place(new Mesh(new ConeGeometry(1.15, 0.55, 8), m.terracotta), 0, 1.65, 0));
  octagon.add(place(new Mesh(new CylinderGeometry(0.48, 0.5, 0.5, 8), m.whitewash), 0, 2.15, 0));
  octagon.add(place(new Mesh(new ConeGeometry(0.72, 0.6, 8), m.terracotta), 0, 2.7, 0));
  octagon.add(place(new Mesh(new SphereGeometry(0.1, 12, 8), m.gold), 0, 3.05, 0));
  octagon.position.set(1.2, terraceTop, 0.8);
  group.add(octagon);

  // Low parapet and a few trees soften the terrace edge.
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + 0.3;
    const radius = 2.75 + (i % 2) * 0.2;
    const tree = place(new Mesh(new IcosahedronGeometry(0.38, 0), m.canopy), Math.cos(angle) * radius, terraceTop + 0.45, Math.sin(angle) * radius);
    tree.scale.set(1, 1.2, 1);
    group.add(tree);
  }
  return { object: group };
}

/* ---------------------------------------------------------------- */
/* Jaffna — stepped gopuram with kalasam finials                     */
/* ---------------------------------------------------------------- */
function buildGopuramTower(m, tiers, baseWidth, baseDepth, tierHeight) {
  const tower = new Group();
  let y = 0;
  const base = place(new Mesh(new BoxGeometry(baseWidth, 1.2 + 2, baseDepth), m.templeRed), 0, y + 0.6 - 1, 0);
  tower.add(base);
  y += 1.2;
  let width = baseWidth * 0.94;
  let depth = baseDepth * 0.94;
  for (let i = 0; i < tiers; i++) {
    const ledge = place(new Mesh(new BoxGeometry(width + 0.14, 0.08, depth + 0.12), m.gold), 0, y + 0.04, 0);
    const tier = place(new Mesh(new BoxGeometry(width, tierHeight, depth), i % 2 ? m.ochre : m.templeRed), 0, y + 0.08 + tierHeight / 2, 0);
    tower.add(ledge, tier);
    y += tierHeight + 0.08;
    width *= 0.86;
    depth *= 0.86;
  }
  // Barrel-vaulted crown (half cylinder) with a row of kalasam finials.
  const crown = place(new Mesh(new CylinderGeometry(depth / 2, depth / 2, width, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), m.gold), 0, y, 0);
  tower.add(crown);
  const finials = Math.max(3, Math.round(width / 0.3));
  for (let i = 0; i < finials; i++) {
    const x = -width / 2 + (width * (i + 0.5)) / finials;
    tower.add(place(new Mesh(new ConeGeometry(0.06, 0.28, 8), m.gold), x, y + depth / 2 + 0.12, 0));
  }
  // Golden arched doorway on the front face.
  const arch = new Mesh(new TorusGeometry(0.32, 0.06, 8, 16, Math.PI), m.gold);
  arch.position.set(0, 0.55, baseDepth / 2 + 0.02);
  tower.add(arch);
  return { tower, height: y + depth / 2 };
}

function buildGopuram(m) {
  const group = new Group();
  const plinthTop = 0.25;
  group.add(place(new Mesh(new BoxGeometry(6.4, 3.2, 5.2), m.paleStone), 0, plinthTop - 1.6, 0));

  const { tower } = buildGopuramTower(m, 7, 2.4, 1.3, 0.52);
  tower.position.set(0, plinthTop, -0.9);
  group.add(tower);

  // Pillared hall and two smaller side towers.
  group.add(place(new Mesh(new BoxGeometry(4.6, 0.7, 1.4), m.ivory), 0, plinthTop + 0.35, 1.25));
  group.add(place(new Mesh(new BoxGeometry(4.8, 0.12, 1.6), m.gold), 0, plinthTop + 0.76, 1.25));
  for (const x of [-2.4, 2.4]) {
    const side = buildGopuramTower(m, 3, 1.0, 0.7, 0.36).tower;
    side.position.set(x, plinthTop, 1.25);
    side.scale.setScalar(0.85);
    group.add(side);
  }
  return { object: group };
}

/* ---------------------------------------------------------------- */
/* Nuwara Eliya — tea-covered hills, silver oaks and drifting mist   */
/* ---------------------------------------------------------------- */
function buildTeaHills(m, { reducedMotion }) {
  const group = new Group();
  const hills = [
    { x: -1.6, z: 0.4, radius: 2.5 },
    { x: 1.6, z: -0.7, radius: 2.1 },
    { x: 0.5, z: 2.0, radius: 1.7 },
  ];
  const flatten = 0.55;
  const bushPositions = [];
  for (const hill of hills) {
    const dome = place(new Mesh(new SphereGeometry(hill.radius, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), m.teaHill), hill.x, -0.35, hill.z);
    dome.scale.y = flatten;
    group.add(dome);
    // Contour rows of tea bushes on the dome surface.
    for (let theta = 0.2; theta < 1.42; theta += 0.085) {
      const ringRadius = hill.radius * Math.sin(theta);
      const count = Math.floor((Math.PI * 2 * ringRadius) / 0.19);
      for (let k = 0; k < count; k++) {
        const phi = (k / count) * Math.PI * 2 + theta * 3.1;
        bushPositions.push(new Vector3(
          hill.x + ringRadius * Math.cos(phi) * 1.01,
          -0.35 + hill.radius * Math.cos(theta) * flatten + 0.04,
          hill.z + ringRadius * Math.sin(phi) * 1.01,
        ));
      }
    }
  }

  const bushes = new InstancedMesh(new SphereGeometry(0.075, 7, 5), m.teaBush, bushPositions.length);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 0.6, 1);
  bushPositions.forEach((position, i) => bushes.setMatrixAt(i, matrix.compose(position, quaternion, scale)));
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  group.add(bushes);

  // Silver oak shade trees.
  const trunkGeometry = new CylinderGeometry(0.025, 0.035, 1.1, 5);
  const crownGeometry = new IcosahedronGeometry(0.2, 0);
  hills.forEach((hill, h) => {
    for (let i = 0; i < 5; i++) {
      const angle = i * 2.4 + h;
      const r = hill.radius * (0.25 + 0.12 * i);
      const theta = Math.asin(Math.min(0.99, r / hill.radius));
      const y = -0.35 + hill.radius * Math.cos(theta) * flatten;
      const x = hill.x + Math.cos(angle) * r;
      const z = hill.z + Math.sin(angle) * r;
      group.add(place(new Mesh(trunkGeometry, m.trunk), x, y + 0.55, z));
      const crown = place(new Mesh(crownGeometry, m.canopy), x, y + 1.15, z);
      crown.scale.set(1, 1.9, 1);
      group.add(crown);
    }
  });

  // A colonial planter's bungalow on the tallest hill.
  const top = -0.35 + hills[1].radius * flatten;
  group.add(place(new Mesh(new BoxGeometry(0.8, 0.35, 0.5), m.whitewash), hills[1].x, top + 0.12, hills[1].z));
  group.add(place(hipRoof(1.0, 0.7, 0.35, m.roofRed), hills[1].x, top + 0.47, hills[1].z));

  // Soft mist sprites drifting across the hills.
  const mistTexture = softSpriteTexture();
  const mist = [0, 1, 2].map((i) => {
    const sprite = new Sprite(new SpriteMaterial({ map: mistTexture, color: '#f4f6f2', transparent: true, opacity: 0.28, depthWrite: false }));
    sprite.scale.set(4.5, 1.6, 1);
    sprite.position.set(-2 + i * 2, 1.4 + i * 0.25, 0.6 - i * 0.6);
    group.add(sprite);
    return sprite;
  });

  return {
    object: group,
    update(time) {
      if (reducedMotion) return;
      mist.forEach((sprite, i) => {
        sprite.position.x = -2 + i * 2 + Math.sin(time * 0.15 + i * 2) * 0.8;
        sprite.material.opacity = 0.2 + 0.1 * Math.sin(time * 0.3 + i);
      });
    },
  };
}

/* ---------------------------------------------------------------- */
/* Galle — bastioned fort ramparts and a working lighthouse          */
/* ---------------------------------------------------------------- */
function fortShape(scale) {
  // Irregular bastioned outline loosely inspired by Galle Fort's ramparts.
  const corners = [[-2.6, -1.2], [-1.2, -2.3], [1.0, -2.1], [2.7, -0.6], [2.3, 1.5], [0.4, 2.4], [-2.0, 1.6]];
  const points = [];
  corners.forEach(([x, z], i) => {
    const [nx, nz] = corners[(i + 1) % corners.length];
    points.push([x * 1.12, z * 1.12]); // pointed bastion
    points.push([x + (nx - x) * 0.3, z + (nz - z) * 0.3]);
    points.push([x + (nx - x) * 0.7, z + (nz - z) * 0.7]);
  });
  const shape = new Shape();
  points.forEach(([x, z], i) => (i ? shape.lineTo(x * scale, -z * scale) : shape.moveTo(x * scale, -z * scale)));
  shape.closePath();
  return shape;
}

function buildLighthouse(m, { reducedMotion }) {
  const group = new Group();
  const wallHeight = 0.5;

  const outer = fortShape(1);
  outer.holes.push(fortShape(0.86));
  const rampart = new Mesh(new ExtrudeGeometry(outer, { depth: wallHeight + 1.5, bevelEnabled: false }).rotateX(-Math.PI / 2), m.stone);
  rampart.position.y = -1.5;
  rampart.castShadow = rampart.receiveShadow = true;
  const lawn = new Mesh(new ShapeGeometry(fortShape(0.87)).rotateX(-Math.PI / 2), m.lawn);
  lawn.position.y = 0.06;
  lawn.receiveShadow = true;
  group.add(rampart, lawn);

  // Old town houses with red roofs.
  const houses = [[-1.2, -0.6], [-0.4, -1.1], [0.4, -0.4], [-1.5, 0.5], [-0.6, 0.8], [0.6, 0.7], [1.3, -0.1], [0.1, 1.5], [-0.9, -1.6]];
  houses.forEach(([x, z], i) => {
    const w = 0.42 + (i % 3) * 0.08;
    group.add(place(new Mesh(new BoxGeometry(w, 0.3, 0.32), m.whitewash), x, 0.2, z, i * 0.4));
    group.add(place(hipRoof(w * 1.15, 0.42, 0.22, m.roofRed), x, 0.46, z, i * 0.4));
  });

  // Clock tower.
  group.add(place(new Mesh(new BoxGeometry(0.3, 1.4, 0.3), m.paleStone), -2.1, 0.7, -0.9));
  group.add(place(hipRoof(0.4, 0.4, 0.3, m.charcoal), -2.1, 1.55, -0.9));

  // Lighthouse on the south-eastern bastion.
  const tower = new Group();
  tower.add(place(new Mesh(new CylinderGeometry(0.24, 0.36, 3.8, 28), m.whitewash), 0, 1.9, 0));
  tower.add(place(new Mesh(new CylinderGeometry(0.42, 0.42, 0.08, 28), m.charcoal), 0, 3.82, 0));
  const lantern = place(new Mesh(new CylinderGeometry(0.22, 0.22, 0.42, 16), m.lantern), 0, 4.07, 0);
  tower.add(lantern);
  tower.add(place(new Mesh(new ConeGeometry(0.28, 0.32, 16), m.charcoal), 0, 4.44, 0));
  tower.add(place(new Mesh(new SphereGeometry(0.05, 8, 6), m.gold), 0, 4.64, 0));

  // Rotating light beam: an open additive cone pivoting around the lantern.
  const beamPivot = new Group();
  beamPivot.position.y = 4.07;
  const beam = new Mesh(
    new ConeGeometry(0.9, 7, 24, 1, true).translate(0, -3.5, 0).rotateZ(Math.PI / 2),
    new MeshBasicMaterial({ color: '#ffe6b0', transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  beam.renderOrder = 5;
  beamPivot.add(beam);
  tower.add(beamPivot);
  tower.position.set(2.45, wallHeight, 1.55);
  group.add(tower);

  return {
    object: group,
    update(time) {
      beamPivot.rotation.y = reducedMotion ? -0.6 : time * 0.6;
    },
  };
}

const BUILDERS = {
  skyline: buildSkyline,
  pavilion: buildPavilion,
  gopuram: buildGopuram,
  'tea-hills': buildTeaHills,
  lighthouse: buildLighthouse,
};

/**
 * Builds the placeholder named by `type` (see destinations.js model.fallback).
 * Unknown types fall back to the pavilion so a destination is never empty.
 */
export function buildLandmark(type, materials, options = {}) {
  const builder = BUILDERS[type] ?? BUILDERS.pavilion;
  return builder(materials, options);
}
