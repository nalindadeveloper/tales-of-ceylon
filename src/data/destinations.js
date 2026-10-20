/**
 * Destination content and placement configuration — the single place to edit
 * destinations. Nothing in here contains animation logic; the scene, cards and
 * scroll system all read from this list.
 *
 * Field reference
 *  id                 Stable identifier (used for DOM ids, state and URLs).
 *  name / province    Display text.
 *  latitude/longitude WGS84 degrees. Projected with src/geography/projection.js.
 *  description        Card copy.
 *  image / imageAlt   Card image (path relative to /public) and its alt text.
 *  imageCredit        Attribution shown in the README / image credits.
 *  link               CTA destination.
 *  model.path         GLB/GLTF file. If it is missing or fails to load, the
 *                     procedural placeholder named by model.fallback is used.
 *  model.scale        Uniform scale applied to the loaded model (scene units
 *                     are kilometres — a model authored at 1 unit ≈ 1 km of
 *                     footprint needs scale ≈ 1).
 *  model.rotationY    Rotation around the vertical axis in degrees.
 *  model.offset       [east, up, south] offset in km from the projected point.
 *  camera.distance    Distance (km) from the camera to the focus target.
 *  camera.azimuth     Horizontal viewing angle in degrees (0 = camera south of
 *                     the target looking north).
 *  camera.tilt        Angle from vertical in degrees (0 = straight down).
 *  camera.targetOffset [east, up, south] km offset of the look-at point.
 *  marker.heightOffset Extra height (km) above the sampled terrain surface.
 */

export const DESTINATIONS = [
  {
    id: 'colombo',
    name: 'Colombo',
    province: 'Western Province',
    latitude: 6.9271,
    longitude: 79.8612,
    description:
      "Discover Sri Lanka's vibrant coastal capital, where colonial architecture, contemporary culture, bustling streets, and the Indian Ocean meet.",
    image: '/assets/images/destinations/colombo.webp',
    imageAlt: 'The Colombo skyline reflected in the still water of Beira Lake at sunset.',
    link: '/destinations/colombo',
    model: {
      path: '/assets/models/destinations/colombo.glb',
      fallback: 'skyline',
      scale: 1.4,
      rotationY: 0,
      offset: [2.2, 0, -0.4],
    },
    camera: { distance: 80, azimuth: -18, tilt: 54, targetOffset: [1.5, 0, 0] },
    marker: { heightOffset: 0.15 },
  },
  {
    id: 'kandy',
    name: 'Kandy',
    province: 'Central Province',
    latitude: 7.2906,
    longitude: 80.6337,
    description:
      'Journey into the cultural heart of Sri Lanka, surrounded by lush hills, historic landmarks, and centuries of tradition.',
    image: '/assets/images/destinations/kandy.webp',
    imageAlt: 'Kandy Lake and the Temple of the Sacred Tooth Relic surrounded by forested hills.',
    link: '/destinations/kandy',
    model: {
      path: '/assets/models/destinations/kandy.glb',
      fallback: 'pavilion',
      scale: 1.6,
      rotationY: 20,
      offset: [0, 0, 0],
    },
    camera: { distance: 82, azimuth: 24, tilt: 52, targetOffset: [0, 0, 0] },
    marker: { heightOffset: 0.15 },
  },
  {
    id: 'jaffna',
    name: 'Jaffna',
    province: 'Northern Province',
    latitude: 9.6615,
    longitude: 80.0255,
    description:
      'Experience the distinctive heritage of northern Sri Lanka, with colorful temples, rich Tamil culture, coastal landscapes, and unforgettable local cuisine.',
    image: '/assets/images/destinations/jaffna.webp',
    imageAlt: 'The ornate red gopuram and golden entrance arch of Nallur Kandaswamy Temple in Jaffna.',
    link: '/destinations/jaffna',
    model: {
      path: '/assets/models/destinations/jaffna.glb',
      fallback: 'gopuram',
      scale: 1.4,
      rotationY: -10,
      offset: [0.6, 0, -0.6],
    },
    camera: { distance: 88, azimuth: -8, tilt: 55, targetOffset: [0, 0, 2] },
    marker: { heightOffset: 0.15 },
  },
  {
    id: 'nuwara-eliya',
    name: 'Nuwara Eliya',
    province: 'Central Province',
    latitude: 6.9497,
    longitude: 80.7891,
    description:
      "Escape into cool mountain air, rolling tea plantations, misty hills, and the timeless charm of Sri Lanka's highlands.",
    image: '/assets/images/destinations/nuwara-eliya.webp',
    imageAlt: 'Tea bushes covering the rolling hills around Nuwara Eliya, with mountains behind.',
    link: '/destinations/nuwara-eliya',
    model: {
      path: '/assets/models/destinations/nuwara-eliya.glb',
      fallback: 'tea-hills',
      scale: 1.5,
      rotationY: 0,
      offset: [-1.2, 0, 1.6],
    },
    camera: { distance: 82, azimuth: 38, tilt: 50, targetOffset: [0, 0, 0] },
    marker: { heightOffset: 0.15 },
  },
  {
    id: 'galle',
    name: 'Galle',
    province: 'Southern Province',
    latitude: 6.0535,
    longitude: 80.221,
    description:
      'Wander through the historic streets of Galle Fort, discover colonial architecture, and enjoy beautiful coastal scenery along the southern shoreline.',
    image: '/assets/images/destinations/galle.webp',
    imageAlt: 'The ramparts and white lighthouse of Galle Fort beside the ocean at sunset.',
    link: '/destinations/galle',
    model: {
      path: '/assets/models/destinations/galle.glb',
      fallback: 'lighthouse',
      scale: 1.4,
      rotationY: 0,
      offset: [0.4, 0, -1.2],
    },
    camera: { distance: 80, azimuth: 8, tilt: 56, targetOffset: [0, 0, -4] },
    marker: { heightOffset: 0.15 },
  },
];
